import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dump } from 'js-toml';
import { quote, parse } from 'shell-quote';
import {
  findPlugin,
  loadBundledPlugins,
  pluginMetadata,
  runPlugin,
} from './plugins.js';
import { renderMarkdown } from './render.js';
import {
  compareEntries,
  isMarkdownFile,
  isTextLikeFile,
  resolveInside,
  shouldIgnore,
  toClientPath,
  type FileTreeEntry,
} from './workspace.js';

type QuickOpenEntry = {
  path: string;
  absolutePath: string;
  name: string;
  dir: string;
  recent: boolean;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_CLIENT_DIR = resolve(__dirname, '..', 'client');
const BUILT_CLIENT_DIR = resolve(process.cwd(), 'dist', 'client');
const ZOTERO_CAYW_URL = 'http://127.0.0.1:23119/better-bibtex/cayw';

function currentFileContent(config: ServerConfig): string {
  if (config.file && existsSync(config.file)) {
    return readFileSync(config.file, 'utf-8');
  }
  return config.fileContent ?? '';
}

function currentWorkspaceRoot(config: ServerConfig): string {
  return resolve(config.workspaceRoot ?? dirname(config.file ?? process.cwd()));
}

function currentDocumentRoot(config: ServerConfig): string {
  if (config.file && !config.isTempFile) {
    return dirname(config.file);
  }
  return currentWorkspaceRoot(config);
}

function resolveUserPath(config: ServerConfig, requestedPath: string): string {
  if (isAbsolute(requestedPath)) {
    return resolve(requestedPath);
  }
  return resolveInside(currentWorkspaceRoot(config), requestedPath);
}

function pathIsInside(root: string, targetPath: string): boolean {
  const rel = relative(root, targetPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export interface ServerConfig {
  renderCommand: string[];
  timeoutMs: number;
  port: number;
  host: string;
  file?: string;
  fileContent?: string;
  workspaceRoot?: string;
  isTempFile?: boolean;
  configPath?: string;
  templatesDir?: string;
  filtersDir?: string;
  debounceMs?: number;
}

export function createApp(config: ServerConfig) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const clientDir = getClientDir();
  const plugins = loadBundledPlugins();
  const recentFiles: string[] = [];
  let currentRenderController: AbortController | null = null;

  function trackRecent(absolutePath: string) {
    recentFiles.splice(
      0,
      recentFiles.length,
      absolutePath,
      ...recentFiles.filter((path) => path !== absolutePath),
    );
    recentFiles.length = Math.min(recentFiles.length, 10);
  }

  // Serve index.html with inlined initial content if a file was specified
  // (must be before express.static to intercept / before it serves index.html raw)
  app.get('/', (_req, res) => {
    const indexPath = resolve(clientDir, 'index.html');
    let html = readFileSync(indexPath, 'utf-8');

    const initialScript = [
      `window.__INITIAL_CONTENT = ${safeJson(currentFileContent(config))};`,
      `window.__INITIAL_FILE = ${safeJson(config.isTempFile ? null : (config.file ?? null))};`,
      `window.__TEMP_BACKUP_FILE = ${safeJson(config.isTempFile ? (config.file ?? null) : null)};`,
      `window.__WORKSPACE_ROOT = ${safeJson(currentWorkspaceRoot(config))};`,
      `window.__IS_TEMP_FILE = ${safeJson(config.isTempFile ?? false)};`,
    ].join(' ');
    html = html.replace('</head>', `<script>${initialScript}<\/script></head>`);

    res.type('html').send(html);
  });

  // Serve other static files from client directory
  app.use(express.static(clientDir));

  app.get('/api/preview-assets', (req, res) => {
    try {
      const documentRoot = currentDocumentRoot(config);
      const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';
      const targetPath = resolveInside(documentRoot, requestedPath);
      const targetStat = statSync(targetPath);
      if (!targetStat.isFile() || shouldIgnore(documentRoot, targetPath)) {
        res.status(404).json({ error: 'asset not found' });
        return;
      }
      res.sendFile(targetPath);
    } catch {
      res.status(404).json({ error: 'asset not found' });
    }
  });

  // Pandoc render endpoint
  app.post<{ html: string; durationMs: number }>('/api/render', async (req, res) => {
    const { markdown } = req.body as {
      markdown?: unknown;
    };
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown field is required' });
      return;
    }

    // Cancel any in-flight render
    if (currentRenderController) {
      currentRenderController.abort();
    }

    const controller = new AbortController();
    currentRenderController = controller;

    const result = await renderMarkdown(
      markdown,
      config.renderCommand,
      config.timeoutMs,
      controller.signal,
    );

    // Only send response if this is still the current render.
    // If superseded, close the connection cleanly with 204 so the client does
    // not hang waiting on a response that will never arrive.
    if (currentRenderController === controller) {
      res.json({
        html: withPreviewAssetUrls(result.html),
        durationMs: result.durationMs,
        ok: result.ok,
        stderr: result.stderr,
      });
    } else {
      res.status(204).end();
    }
  });

  // Save endpoint
  app.post<{ markdown: string; path?: string }>('/api/save', async (req, res) => {
    const { markdown, path } = req.body;
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown field is required' });
      return;
    }
    // Resolve workspace-relative paths, absolute paths, or use configured file.
    let targetPath: string | undefined;
    if (typeof path === 'string' && path.length > 0) {
      targetPath = resolveUserPath(config, path);
    } else {
      targetPath = config.file;
    }
    if (!targetPath) {
      res.status(400).json({ error: 'no file path configured or provided' });
      return;
    }
    try {
      const workspaceRoot = currentWorkspaceRoot(config);
      // Ensure parent directories exist so saves into new subdirs always succeed.
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, markdown, 'utf-8');
      trackRecent(targetPath);
      // Track the saved file for reloads; move the workspace root only when the
      // user explicitly saves outside the current workspace.
      if (typeof path === 'string' && path.length > 0 && targetPath !== config.file) {
        config.file = targetPath;
        config.isTempFile = false;
        config.workspaceRoot = pathIsInside(workspaceRoot, targetPath)
          ? workspaceRoot
          : dirname(targetPath);
      }
      res.json({
        ok: true,
        path: targetPath,
        workspaceRoot: currentWorkspaceRoot(config),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post<{ markdown: string }>('/api/backup', async (req, res) => {
    const { markdown } = req.body;
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown field is required' });
      return;
    }
    if (!config.isTempFile || !config.file) {
      res.status(409).json({ error: 'no temporary backup file is active' });
      return;
    }

    try {
      writeFileSync(config.file, markdown, 'utf-8');
      res.json({ ok: true, backupPath: config.file });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Filesystem browser for the file-selector dialog.
  // Accepts an absolute path; has no workspace-root restriction.
  // Returns { dir, parent, entries } where parent is null at the fs root.
  app.get('/api/browse', (req, res) => {
    const requestedDir = typeof req.query.dir === 'string' ? req.query.dir : '';
    if (!requestedDir) {
      res.status(400).json({ error: 'dir query parameter is required' });
      return;
    }
    const targetDir = resolve(requestedDir);
    try {
      const stat = statSync(targetDir);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: 'dir must be a directory' });
        return;
      }

      const BROWSE_IGNORE = new Set([
        '.git',
        'node_modules',
        'dist',
        'build',
        'coverage',
      ]);
      type BrowseEntry = {
        name: string;
        absolutePath: string;
        kind: 'directory' | 'file';
      };
      const entries = readdirSync(targetDir, { withFileTypes: true })
        .flatMap((entry): BrowseEntry[] => {
          // Skip hidden files and standard noise directories.
          if (entry.name.startsWith('.') || BROWSE_IGNORE.has(entry.name)) return [];
          if (entry.isDirectory()) {
            return [
              {
                name: entry.name,
                absolutePath: resolve(targetDir, entry.name),
                kind: 'directory',
              },
            ];
          }
          if (entry.isFile()) {
            return [
              {
                name: entry.name,
                absolutePath: resolve(targetDir, entry.name),
                kind: 'file',
              },
            ];
          }
          return [];
        })
        .sort((a: BrowseEntry, b: BrowseEntry) => {
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      // Parent is null when we're at the filesystem root.
      const parentDir = resolve(targetDir, '..');
      const parent = parentDir === targetDir ? null : parentDir;

      res.json({ dir: targetDir, parent, entries });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/files', (req, res) => {
    const requestedDir = typeof req.query.dir === 'string' ? req.query.dir : '';

    try {
      const workspaceRoot = currentWorkspaceRoot(config);
      const targetDir = resolveInside(workspaceRoot, requestedDir);
      const targetStat = statSync(targetDir);
      if (!targetStat.isDirectory()) {
        res.status(400).json({ error: 'dir must reference a directory' });
        return;
      }

      const entries = readdirSync(targetDir, { withFileTypes: true })
        .map((entry) => {
          const absolutePath = resolve(targetDir, entry.name);
          const clientPath = toClientPath(workspaceRoot, absolutePath);
          if (shouldIgnore(workspaceRoot, absolutePath)) return null;

          if (entry.isDirectory()) {
            return { name: entry.name, path: clientPath, kind: 'directory' as const };
          }

          if (entry.isFile() && isTextLikeFile(absolutePath)) {
            return { name: entry.name, path: clientPath, kind: 'file' as const };
          }

          return null;
        })
        .filter((entry): entry is FileTreeEntry => entry != null)
        .sort(compareEntries);

      res.json({
        root: workspaceRoot,
        dir: toClientPath(workspaceRoot, targetDir),
        entries,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/files/quick-open', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';

    try {
      const workspaceRoot = currentWorkspaceRoot(config);
      const workspaceEntries = await collectMarkdownFilesAsync(
        workspaceRoot,
        workspaceRoot,
      );
      const recentEntries = recentFiles
        .filter((absolutePath) => {
          try {
            return (
              pathIsInside(workspaceRoot, absolutePath) &&
              existsSync(absolutePath) &&
              statSync(absolutePath).isFile() &&
              isMarkdownFile(absolutePath) &&
              !shouldIgnore(workspaceRoot, absolutePath)
            );
          } catch {
            return false;
          }
        })
        .map((absolutePath) => quickOpenEntry(workspaceRoot, absolutePath, true));

      const recentPaths = new Set(recentEntries.map((entry) => entry.path));
      const entries = [
        ...recentEntries,
        ...workspaceEntries.filter((entry) => !recentPaths.has(entry.path)),
      ].filter((entry) => quickOpenMatches(entry, query));

      res.json({ root: workspaceRoot, entries });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/files/content', (req, res) => {
    const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';

    try {
      const workspaceRoot = currentWorkspaceRoot(config);
      const targetPath = resolveInside(workspaceRoot, requestedPath);
      const targetStat = statSync(targetPath);
      if (!targetStat.isFile()) {
        res.status(400).json({ error: 'path must reference a file' });
        return;
      }
      if (!isTextLikeFile(targetPath)) {
        res.status(415).json({ error: 'file does not look like text' });
        return;
      }
      trackRecent(targetPath);

      res.json({
        path: toClientPath(workspaceRoot, targetPath),
        absolutePath: targetPath,
        content: readFileSync(targetPath, 'utf-8'),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });
  app.get('/api/files/exists', (req, res) => {
    const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!requestedPath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }
    try {
      const targetPath = resolveUserPath(config, requestedPath);
      res.json({ exists: existsSync(targetPath) });
    } catch {
      res.json({ exists: false });
    }
  });

  app.post('/api/open-file', (req, res) => {
    const { path: filePath } = req.body as { path?: string };
    if (typeof filePath !== 'string' || filePath.length === 0) {
      res.status(400).json({ error: 'path field is required' });
      return;
    }
    try {
      const targetPath = resolveUserPath(config, filePath);
      const child = spawn('xdg-open', [targetPath], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/pandoc/assets
  app.get('/api/pandoc/assets', async (_req, res) => {
    try {
      const home = homedir();
      const resolveTilde = (p: string) => {
        if (p.startsWith('~/')) return join(home, p.slice(2));
        if (p === '~') return home;
        return p;
      };

      const templatesDir = resolveTilde(config.templatesDir ?? '~/.pandoc/templates');
      const filtersDir = resolveTilde(config.filtersDir ?? '~/.pandoc/filters');

      let templates: string[] = [];
      let filters: string[] = [];

      if (existsSync(templatesDir)) {
        templates = readdirSync(templatesDir)
          .filter((name) => name.endsWith('.html') || name.endsWith('.template'))
          .filter((name) => statSync(join(templatesDir, name)).isFile());
      }

      if (existsSync(filtersDir)) {
        filters = readdirSync(filtersDir).filter((name) =>
          statSync(join(filtersDir, name)).isFile(),
        );
      }

      res.json({ templates, filters });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/config
  app.get('/api/config', (_req, res) => {
    res.json({
      templatesDir: config.templatesDir ?? '~/.pandoc/templates',
      filtersDir: config.filtersDir ?? '~/.pandoc/filters',
      debounceMs: config.debounceMs ?? 750,
      timeoutMs: config.timeoutMs ?? 30000,
      renderCommand: quote(config.renderCommand),
    });
  });

  // POST /api/config
  app.post('/api/config', (req, res) => {
    const { templatesDir, filtersDir, debounceMs, timeoutMs, renderCommand } =
      req.body as {
        templatesDir: string;
        filtersDir: string;
        debounceMs: number;
        timeoutMs: number;
        renderCommand: string;
      };

    if (
      typeof templatesDir !== 'string' ||
      typeof filtersDir !== 'string' ||
      typeof debounceMs !== 'number' ||
      typeof timeoutMs !== 'number' ||
      typeof renderCommand !== 'string'
    ) {
      res.status(400).json({ error: 'Invalid configuration parameters' });
      return;
    }

    const parsed = parse(renderCommand).filter(
      (entry): entry is string => typeof entry === 'string',
    );
    if (parsed.length === 0) {
      res
        .status(400)
        .json({ error: 'renderCommand must be a non-empty shell command' });
      return;
    }

    const home = homedir();
    const resolveTilde = (p: string) => {
      if (p.startsWith('~/')) return join(home, p.slice(2));
      if (p === '~') return home;
      return p;
    };

    const expandTildePaths = (argsArray: string[]): string[] => {
      return argsArray.map((arg) => {
        if (arg.startsWith('~/') || arg === '~') {
          return home + arg.slice(1);
        }
        const eqIdx = arg.indexOf('=');
        if (eqIdx >= 0) {
          const prefix = arg.slice(0, eqIdx + 1);
          const value = arg.slice(eqIdx + 1);
          if (value.startsWith('~/') || value === '~') {
            return prefix + home + value.slice(1);
          }
        }
        return arg;
      });
    };

    // Validation
    const absTemplatesDir = resolve(resolveTilde(templatesDir));
    const absFiltersDir = resolve(resolveTilde(filtersDir));

    try {
      for (let i = 0; i < parsed.length; i++) {
        const arg = parsed[i];
        let templatePath: string | null = null;
        let filterPath: string | null = null;

        if (arg.startsWith('--template=')) {
          templatePath = arg.slice('--template='.length);
        } else if (arg === '--template' && i + 1 < parsed.length) {
          templatePath = parsed[i + 1];
        } else if (arg.startsWith('--lua-filter=')) {
          filterPath = arg.slice('--lua-filter='.length);
        } else if (arg === '--lua-filter' && i + 1 < parsed.length) {
          filterPath = parsed[i + 1];
        } else if (arg.startsWith('--filter=')) {
          filterPath = arg.slice('--filter='.length);
        } else if (arg === '--filter' && i + 1 < parsed.length) {
          filterPath = parsed[i + 1];
        }

        if (templatePath) {
          const resolvedT = resolve(resolveTilde(templatePath));
          const parentDir = dirname(resolvedT);
          if (parentDir !== absTemplatesDir) {
            res.status(400).json({
              error: `Template file '${basename(templatePath)}' is external. Please place it in the templates directory '${templatesDir}' first so the app can discover it.`,
            });
            return;
          }
        }

        if (filterPath) {
          const resolvedF = resolve(resolveTilde(filterPath));
          const parentDir = dirname(resolvedF);
          if (parentDir !== absFiltersDir) {
            res.status(400).json({
              error: `Filter file '${basename(filterPath)}' is external. Please place it in the filters directory '${filtersDir}' first so the app can discover it.`,
            });
            return;
          }
        }
      }

      // Update in-memory config
      config.templatesDir = templatesDir;
      config.filtersDir = filtersDir;
      config.debounceMs = debounceMs;
      config.timeoutMs = timeoutMs;
      config.renderCommand = expandTildePaths(parsed);

      // Persist to TOML file
      if (config.configPath) {
        const tomlData = {
          render: {
            debounce_ms: debounceMs,
            timeout_ms: timeoutMs,
          },
          pandoc: {
            render_command: renderCommand,
            templates_dir: templatesDir,
            filters_dir: filtersDir,
          },
        };
        writeFileSync(config.configPath, dump(tomlData), 'utf-8');
      }

      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/files/new', (req, res) => {
    try {
      const { path: requestedPath } = req.body as { path?: string };
      const targetPath =
        typeof requestedPath === 'string' && requestedPath.length > 0
          ? resolveUserPath(config, requestedPath)
          : resolveUserPath(config, `untitled-${randomUUID()}.md`);
      if (existsSync(targetPath)) {
        res.status(409).json({ error: 'file already exists' });
        return;
      }
      config.file = targetPath;
      config.fileContent = '';
      config.isTempFile = false;
      config.workspaceRoot = dirname(targetPath);
      trackRecent(targetPath);
      res.json({
        ok: true,
        path: targetPath,
        absolutePath: targetPath,
        content: '',
        workspaceRoot: currentWorkspaceRoot(config),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/plugins', (_req, res) => {
    res.json({ plugins: plugins.map(pluginMetadata) });
  });

  app.get('/api/zotero/cite', async (_req, res) => {
    const url = new URL(ZOTERO_CAYW_URL);
    url.searchParams.set('format', 'pandoc');
    url.searchParams.set('brackets', '1');

    try {
      const response = await fetch(url);
      if (!response.ok) {
        res.status(502).json({ error: `zotero returned ${response.status}` });
        return;
      }

      const citation = (await response.text()).trim();
      if (citation.length === 0) {
        res.status(204).send();
        return;
      }

      res.json({ citation });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  app.post('/api/figures/assets', (req, res) => {
    const { contentBase64, documentPath, filename, mimeType } = req.body as {
      contentBase64?: unknown;
      documentPath?: unknown;
      filename?: unknown;
      mimeType?: unknown;
    };

    if (typeof documentPath !== 'string' || documentPath.length === 0) {
      res.status(400).json({ error: 'documentPath field is required' });
      return;
    }
    if (typeof contentBase64 !== 'string' || contentBase64.length === 0) {
      res.status(400).json({ error: 'contentBase64 field is required' });
      return;
    }
    if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) {
      res.status(400).json({ error: 'mimeType must be an image type' });
      return;
    }

    const targetDocument = resolveUserPath(config, documentPath);
    if (!config.file || config.isTempFile || targetDocument !== config.file) {
      res.status(409).json({ error: 'save the document before adding figures' });
      return;
    }

    const figuresDir = resolve(dirname(targetDocument), 'figures');
    const figureName =
      typeof filename === 'string' && filename.length > 0
        ? sanitizeFigureFilename(filename, mimeType)
        : `figure-${randomUUID()}${imageExtension(mimeType)}`;
    const figurePath = resolve(figuresDir, figureName);
    if (!pathIsInside(figuresDir, figurePath)) {
      res.status(400).json({ error: 'figure path escapes figures directory' });
      return;
    }
    if (existsSync(figurePath)) {
      res.status(409).json({ error: 'figure already exists' });
      return;
    }

    try {
      mkdirSync(figuresDir, { recursive: true });
      writeFileSync(figurePath, Buffer.from(contentBase64, 'base64'));
      const relativePath = `figures/${figureName}`;
      res.json({
        ok: true,
        path: figurePath,
        relativePath,
        markdown: `![](./${relativePath})`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/plugins/:id/run', async (req, res) => {
    const plugin = findPlugin(plugins, req.params.id);
    if (!plugin) {
      res.status(404).json({ error: 'plugin not found' });
      return;
    }

    const { markdown, path } = req.body as { markdown?: unknown; path?: unknown };
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown field is required' });
      return;
    }

    const targetPath = typeof path === 'string' ? path : config.file;
    if (!targetPath || config.isTempFile) {
      res
        .status(400)
        .json({ ok: false, error: 'no file path: save the document first' });
      return;
    }

    try {
      writeFileSync(targetPath, markdown, 'utf-8');
      trackRecent(targetPath);
      const result = await runPlugin(plugin, targetPath, config.timeoutMs);
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  return app;
}

export function startServer(config: ServerConfig) {
  const app = createApp(config);
  app.listen(config.port, config.host, () => {
    const url = `http://${config.host}:${config.port}`;
    console.log(`pandoc-preview running at ${url}`);
  });
}

function getClientDir() {
  if (existsSync(resolve(BUILT_CLIENT_DIR, 'index.html'))) {
    return BUILT_CLIENT_DIR;
  }
  return SOURCE_CLIENT_DIR;
}

async function collectMarkdownFilesAsync(
  workspaceRoot: string,
  dir: string,
): Promise<QuickOpenEntry[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const results = await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = resolve(dir, entry.name);
        if (shouldIgnore(workspaceRoot, absolutePath)) return [];

        if (entry.isDirectory()) {
          return collectMarkdownFilesAsync(workspaceRoot, absolutePath);
        }

        if (entry.isFile() && isMarkdownFile(absolutePath)) {
          return [quickOpenEntry(workspaceRoot, absolutePath, false)];
        }

        return [];
      }),
    );
    return results.flat().toSorted((a, b) => a.path.localeCompare(b.path));
  } catch {
    return [];
  }
}

function quickOpenEntry(
  workspaceRoot: string,
  absolutePath: string,
  recent: boolean,
): QuickOpenEntry {
  const path = toClientPath(workspaceRoot, absolutePath);
  return {
    path,
    absolutePath,
    name: path.split('/').at(-1) ?? path,
    dir: dirname(path) === '.' ? '' : dirname(path),
    recent,
  };
}

function quickOpenMatches(entry: QuickOpenEntry, query: string) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return (
    entry.name.toLowerCase().includes(normalized) ||
    entry.path.toLowerCase().includes(normalized)
  );
}

function sanitizeFigureFilename(filename: string, mimeType: string) {
  const sanitized = filename
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^-+/, '')
    .slice(0, 120);
  const fallback = `figure-${randomUUID()}${imageExtension(mimeType)}`;
  return sanitized && sanitized.length > 0 ? sanitized : fallback;
}

function imageExtension(mimeType: string) {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/svg+xml':
      return '.svg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '.png';
  }
}

function withPreviewAssetUrls(html: string) {
  return html.replace(
    /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|\bsrc=(["'])(?![A-Za-z][A-Za-z\d+.-]*:|\/|#)([^"']+)\1/g,
    (match, quote?: string, url?: string) => {
      if (match.startsWith('<!--') || match.startsWith('<script')) {
        return match;
      }
      return `src=${quote}/api/preview-assets?path=${encodeURIComponent(url!)}${quote}`;
    },
  );
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}
