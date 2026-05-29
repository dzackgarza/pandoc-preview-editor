import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import {
  extractFilterPaths,
  removeFilterFlags,
  validateCommandPaths,
} from './command-parser.js';
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
import { spawn, exec } from 'node:child_process';
import { homedir } from 'node:os';
import { dump } from 'js-toml';
import { quote } from 'shell-quote';
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
  writeFileSyncAtomic,
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
const SOURCE_CLIENT_DIR = resolve(__dirname, '..', '..', 'src', 'client');
const BUILT_CLIENT_DIR = resolve(__dirname, '..', '..', 'dist', 'client');
const ZOTERO_CAYW_URL = 'http://127.0.0.1:23119/better-bibtex/cayw';

const xdgStateHome = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
const xdgStateDir = join(xdgStateHome, 'pandoc-preview');
const backupDir = join(xdgStateDir, 'backups');
const stateFilePath = join(xdgStateDir, 'state.json');

function getBackupPath(documentPath: string): string {
  const hash = createHash('sha256').update(resolve(documentPath)).digest('hex');
  return join(backupDir, `${hash}.md`);
}

const saveSessionState = (state: { last_file: string; is_temp_file: boolean }) => {
  try {
    mkdirSync(xdgStateDir, { recursive: true });
    writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Failed to save session state: ${err}`);
  }
};

function getBackupContent(filePath?: string): string | null {
  if (!filePath) return null;
  const backupPath = getBackupPath(filePath);
  if (existsSync(backupPath)) {
    try {
      return readFileSync(backupPath, 'utf-8');
    } catch (err) {
      console.error(`Failed to read backup from ${backupPath}: ${err}`);
    }
  }
  return null;
}

function currentFileContent(config: ServerConfig): string {
  if (config.file) {
    const backupContent = getBackupContent(config.file);
    if (backupContent !== null) {
      return backupContent;
    }
    if (existsSync(config.file)) {
      return readFileSync(config.file, 'utf-8');
    }
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
  renderCommand: string;
  timeoutMs: number;
  port: number;
  host: string;
  file?: string;
  fileContent?: string;
  workspaceRoot?: string;
  isTempFile?: boolean;
  configPath?: string;
  templatesDir: string;
  filtersDir: string;
  debounceMs: number;
  launcherCommand?: string;
  recoveredFromBackup?: boolean;
}

const fileFingerprints = new Map<string, { mtimeMs: number; hash: string }>();

function getFileFingerprint(filePath: string): { mtimeMs: number; hash: string } | null {
  try {
    if (!existsSync(filePath)) return null;
    const stat = statSync(filePath);
    if (!stat.isFile()) return null;
    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    return {
      mtimeMs: stat.mtimeMs,
      hash,
    };
  } catch {
    return null;
  }
}

function registerFingerprint(filePath: string) {
  const fp = getFileFingerprint(filePath);
  if (fp) {
    fileFingerprints.set(filePath, fp);
  }
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

    if (config.file && !config.isTempFile && existsSync(config.file)) {
      registerFingerprint(config.file);
    }

    const hasBackup = !!(config.recoveredFromBackup || (config.file ? existsSync(getBackupPath(config.file)) : false));

    const initialScript = [
      `window.__INITIAL_CONTENT = ${safeJson(currentFileContent(config))};`,
      `window.__INITIAL_FILE = ${safeJson(config.isTempFile ? null : (config.file ?? null))};`,
      `window.__TEMP_BACKUP_FILE = ${safeJson(config.isTempFile ? (config.file ?? null) : null)};`,
      `window.__WORKSPACE_ROOT = ${safeJson(currentWorkspaceRoot(config))};`,
      `window.__IS_TEMP_FILE = ${safeJson(config.isTempFile ?? false)};`,
      `window.__RECOVERED_FROM_BACKUP = ${safeJson(hasBackup)};`,
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

      if (existsSync(targetPath)) {
        const registeredFp = fileFingerprints.get(targetPath);
        if (registeredFp) {
          const diskFp = getFileFingerprint(targetPath);
          if (diskFp && diskFp.mtimeMs !== registeredFp.mtimeMs && diskFp.hash !== registeredFp.hash) {
            res.status(409).json({ error: 'The file has been modified externally.' });
            return;
          }
        }
      }

      const oldPath = config.file;

      writeFileSyncAtomic(targetPath, markdown);
      registerFingerprint(targetPath);
      trackRecent(targetPath);
      // Track the saved file for reloads; move the workspace root only when the
      // user explicitly saves outside the current workspace.
      if (typeof path === 'string' && path.length > 0 && targetPath !== config.file) {
        config.file = targetPath;
        config.isTempFile = false;
        config.workspaceRoot = pathIsInside(workspaceRoot, targetPath)
          ? workspaceRoot
          : dirname(targetPath);
      } else if (config.file === targetPath) {
        config.isTempFile = false;
      }

      // Clean up backup files
      try {
        if (oldPath) {
          const oldBackup = getBackupPath(oldPath);
          if (existsSync(oldBackup)) {
            const { rmSync } = await import('node:fs');
            rmSync(oldBackup, { force: true });
          }
        }
        const targetBackup = getBackupPath(targetPath);
        if (existsSync(targetBackup)) {
          const { rmSync } = await import('node:fs');
          rmSync(targetBackup, { force: true });
        }
      } catch (backupErr) {
        console.error(`Failed to clean up backup files: ${backupErr}`);
      }

      // Update session state
      saveSessionState({
        last_file: targetPath,
        is_temp_file: !!config.isTempFile,
      });

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

  app.post<{ markdown: string; path?: string }>('/api/backup', async (req, res) => {
    const { markdown, path } = req.body;
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown field is required' });
      return;
    }

    let docPath: string | undefined;
    if (typeof path === 'string' && path.length > 0) {
      docPath = resolveUserPath(config, path);
    } else {
      docPath = config.file;
    }

    if (!docPath) {
      res.status(400).json({ error: 'No active file or path provided for backup' });
      return;
    }

    try {
      const backupPath = getBackupPath(docPath);
      mkdirSync(dirname(backupPath), { recursive: true });
      writeFileSync(backupPath, markdown, 'utf-8');

      // Update session state
      saveSessionState({
        last_file: docPath,
        is_temp_file: docPath === config.file ? !!config.isTempFile : false,
      });

      res.json({ ok: true, backupPath });
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

  app.post('/api/files/quick-open-spawn', (req, res) => {
    try {
      const workspaceRoot = currentWorkspaceRoot(config);
      let cmd = config.launcherCommand;

      if (!cmd) {
        const hasRofi = existsSync('/bin/rofi') || existsSync('/usr/bin/rofi');
        const hasDmenu = existsSync('/bin/dmenu') || existsSync('/usr/bin/dmenu');
        const hasFd = existsSync('/bin/fd') || existsSync('/usr/bin/fd');

        const finder = hasFd ? 'fd -e md -t f' : 'find . -name "*.md"';
        if (hasRofi) {
          cmd = `${finder} | rofi -dmenu -i -p "Quick Open:"`;
        } else if (hasDmenu) {
          cmd = `${finder} | dmenu -i -p "Quick Open:"`;
        } else {
          cmd = `${finder} | dmenu -i -p "Quick Open:"`;
        }
      }

      exec(cmd, { cwd: workspaceRoot }, (err, stdout, stderr) => {
        if (err && (err.code === 130 || err.code === 1)) {
          res.json({ ok: false, cancelled: true });
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          res.json({ ok: false, cancelled: true });
          return;
        }

        try {
          const targetPath = resolveInside(workspaceRoot, trimmed);
          if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
            res.json({
              ok: false,
              error: `Selected path "${trimmed}" does not exist or is not a file.`,
            });
            return;
          }
          if (!isMarkdownFile(targetPath)) {
            res.json({
              ok: false,
              error: `Selected path "${trimmed}" is not a markdown file.`,
            });
            return;
          }

          trackRecent(targetPath);
          const relativePath = toClientPath(workspaceRoot, targetPath);
          const content = readFileSync(targetPath, 'utf-8');
          registerFingerprint(targetPath);

          // Update active config file & track session
          config.file = targetPath;
          config.isTempFile = false;
          saveSessionState({
            last_file: targetPath,
            is_temp_file: false,
          });

          res.json({
            ok: true,
            path: relativePath,
            absolutePath: targetPath,
            content,
          });
        } catch (innerErr) {
          const message =
            innerErr instanceof Error ? innerErr.message : String(innerErr);
          res.json({ ok: false, error: message });
        }
      });
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
      registerFingerprint(targetPath);

      // Update active config file & track session
      config.file = targetPath;
      config.isTempFile = false;
      saveSessionState({
        last_file: targetPath,
        is_temp_file: false,
      });

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
      let templates: string[] = [];
      let filters: string[] = [];

      if (existsSync(config.templatesDir)) {
        templates = readdirSync(config.templatesDir)
          .filter((name) => name.endsWith('.html') || name.endsWith('.template'))
          .filter((name) => statSync(join(config.templatesDir, name)).isFile());
      }

      if (existsSync(config.filtersDir)) {
        filters = readdirSync(config.filtersDir).filter((name) =>
          statSync(join(config.filtersDir, name)).isFile(),
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
      templatesDir: config.templatesDir,
      filtersDir: config.filtersDir,
      debounceMs: config.debounceMs ?? 750,
      timeoutMs: config.timeoutMs ?? 30000,
      renderCommand: config.renderCommand,
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

    if (typeof renderCommand !== 'string' || renderCommand.trim() === '') {
      res
        .status(400)
        .json({ error: 'renderCommand must be a non-empty shell command' });
      return;
    }

    try {
      const validation = validateCommandPaths(renderCommand, templatesDir, filtersDir);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }

      // Update in-memory config with absolute paths
      config.templatesDir = resolve(templatesDir);
      config.filtersDir = resolve(filtersDir);
      config.debounceMs = debounceMs;
      config.timeoutMs = timeoutMs;
      config.renderCommand = renderCommand;

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

  // GET /api/filters - list available Lua filters and their state in renderCommand
  app.get('/api/filters', (_req, res) => {
    try {
      let files: string[] = [];
      if (existsSync(config.filtersDir)) {
        files = readdirSync(config.filtersDir).filter((name) => {
          return (
            name.endsWith('.lua') && statSync(join(config.filtersDir, name)).isFile()
          );
        });
      }

      // Filter paths in the command string may use ~/ notation — expand them
      const home = homedir();
      const expandTilde = (p: string) => {
        if (p.startsWith('~/')) return join(home, p.slice(2));
        if (p === '~') return home;
        return p;
      };

      const rawFilterPaths = extractFilterPaths(config.renderCommand);
      const activeFilters = new Set(rawFilterPaths.map((p) => resolve(expandTilde(p))));

      const filters = files.map((name) => {
        const absPath = resolve(join(config.filtersDir, name));
        return {
          name,
          path: join(config.filtersDir, name),
          enabled: activeFilters.has(absPath),
        };
      });

      res.json({ filters });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/filters - toggle Lua filters on/off in renderCommand
  app.post('/api/filters', (req, res) => {
    const { enabled } = req.body as { enabled?: unknown };
    if (!Array.isArray(enabled)) {
      res
        .status(400)
        .json({ error: 'enabled field must be an array of string paths/names' });
      return;
    }

    try {
      // Remove existing filter flags that point to files in the filters directory
      const remainingArgs = removeFilterFlags(config.renderCommand, config.filtersDir);

      // Add new filter flags for the enabled filters
      for (const filterItem of enabled) {
        if (typeof filterItem !== 'string') continue;
        const filename = filterItem.endsWith('.lua')
          ? basename(filterItem)
          : `${basename(filterItem)}.lua`;
        const pathOption = join(config.filtersDir, filename);
        remainingArgs.push(`--lua-filter=${pathOption}`);
      }

      const newCommand = quote(['pandoc', ...remainingArgs]);
      config.renderCommand = newCommand;

      if (config.configPath) {
        const tomlData = {
          render: {
            debounce_ms: config.debounceMs,
            timeout_ms: config.timeoutMs,
          },
          pandoc: {
            render_command: newCommand,
            templates_dir: config.templatesDir,
            filters_dir: config.filtersDir,
          },
        };
        writeFileSync(config.configPath, dump(tomlData), 'utf-8');
      }

      res.json({ ok: true, renderCommand: newCommand });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/diagram/file - create diagram starter templates relative to document
  app.post('/api/diagram/file', (req, res) => {
    const { type, filename, documentPath } = req.body as {
      type?: unknown;
      filename?: unknown;
      documentPath?: unknown;
    };

    if (
      typeof type !== 'string' ||
      typeof filename !== 'string' ||
      typeof documentPath !== 'string'
    ) {
      res.status(400).json({ error: 'type, filename, and documentPath are required' });
      return;
    }

    if (
      config.isTempFile ||
      !config.file ||
      resolveUserPath(config, documentPath) !== config.file
    ) {
      res.status(409).json({ error: 'save the document before adding figures' });
      return;
    }

    const figuresDir = resolve(dirname(config.file), 'figures');
    const figurePath = resolve(figuresDir, filename);

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

      let template = '';
      if (type === 'qtikz' || type === 'tikzit') {
        template =
          [
            '\\begin{tikzpicture}',
            '  \\draw (0,0) circle (1in);',
            '\\end{tikzpicture}',
          ].join('\n') + '\n';
      } else if (type === 'inkscape') {
        template =
          [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">',
            '  <circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" />',
            '</svg>',
          ].join('\n') + '\n';
      } else if (type === 'xournal') {
        template =
          [
            '<?xml version="1.0" standalone="no"?>',
            '<xournal version="0.4.8.2016">',
            '<title>Xournal Document</title>',
            '<page width="612.00000000" height="792.00000000">',
            '<background type="solid" color="#ffffffff" style="plain"/>',
            '<layer/>',
            '</page>',
            '</xournal>',
          ].join('\n') + '\n';
      }

      writeFileSync(figurePath, template, 'utf-8');

      res.json({
        ok: true,
        absolutePath: figurePath,
        relativePath: `figures/${filename}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/diagram/launch - launch desktop application pointing to the newly created asset
  app.post('/api/diagram/launch', (req, res) => {
    const { absolutePath, type } = req.body as {
      absolutePath?: unknown;
      type?: unknown;
    };
    if (typeof absolutePath !== 'string' || typeof type !== 'string') {
      res.status(400).json({ error: 'absolutePath and type are required' });
      return;
    }

    try {
      let cmd = type;
      if (type === 'xournal') {
        cmd = 'xournalpp';
      }

      const child = spawn(cmd, [absolutePath], {
        detached: true,
        stdio: 'ignore',
      });

      child.on('error', (err) => {
        console.error(`Failed to start desktop app ${cmd}:`, err);
      });

      child.unref();
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/diagram/proxy - premium same-origin web integration proxy
  app.get('/api/diagram/proxy', async (req, res) => {
    const urlStr = typeof req.query.url === 'string' ? req.query.url : '';
    if (!urlStr) {
      res.status(400).json({ error: 'url parameter is required' });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    const allowedHosts = new Set(['q.uiver.app', 'freetikz.app']);
    const isTest = process.env.NODE_ENV === 'test';
    const isAllowedHost = allowedHosts.has(parsed.hostname) && parsed.protocol === 'https:';
    const isAllowedTest = isTest && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && parsed.protocol === 'http:';

    if (!isAllowedHost && !isAllowedTest) {
      res.status(403).json({ error: 'Forbidden: URL is not whitelisted' });
      return;
    }

    try {
      const response = await fetch(urlStr);
      if (!response.ok) {
        res.status(502).json({ error: `proxy failed with status ${response.status}` });
        return;
      }

      let html = await response.text();

      const baseTag = `<base href="${urlStr}">`;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${baseTag}`);
      } else {
        html = baseTag + html;
      }

      const premiumOverlay = [
        '<div id="pandoc-preview-export-overlay" style="position: fixed; top: 12px; right: 12px; z-index: 2147483647; background: linear-gradient(135deg, #1e1e2e 0%, #181825 100%); color: #cdd6f4; padding: 16px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: \'Outfit\', \'Inter\', sans-serif; display: flex; flex-direction: column; gap: 10px; border: 1px solid rgba(137, 180, 250, 0.2); width: 280px; backdrop-filter: blur(10px); transition: all 0.3s ease;">',
        '  <div style="display: flex; align-items: center; gap: 8px;">',
        '    <span style="background: #89b4fa; color: #11111b; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 999px; text-transform: uppercase;">Preview</span>',
        '    <div style="font-size: 13px; font-weight: 700; color: #f5c2e7;">TikZ Integrator</div>',
        '  </div>',
        '  <button id="pandoc-preview-btn-export" style="background: linear-gradient(90deg, #89b4fa 0%, #b4befe 100%); color: #11111b; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 13px; box-shadow: 0 4px 15px rgba(137,180,250,0.3); transition: transform 0.2s, box-shadow 0.2s;">Insert into Document</button>',
        '  <div id="pandoc-preview-status" style="font-size: 11px; color: #a6adc8; line-height: 1.4;">Draw your diagram, click the export/LaTeX button inside this tool, then click "Insert" above.</div>',
        '</div>',
        '<style>',
        '  #pandoc-preview-btn-export:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(137,180,250,0.5); }',
        '  #pandoc-preview-btn-export:active { transform: translateY(0); }',
        '</style>',
        '<script>',
        "  document.getElementById('pandoc-preview-btn-export').addEventListener('click', () => {",
        "    let code = '';",
        "    const textAreas = Array.from(document.querySelectorAll('textarea'));",
        '    for (const ta of textAreas) {',
        "      if (ta.value.includes('\\\\begin{tikzcd}') || ta.value.includes('\\\\begin{tikzpicture}')) {",
        '        code = ta.value;',
        '        break;',
        '      }',
        '    }',
        '    if (!code) {',
        "      const elements = Array.from(document.querySelectorAll('div, pre, code, p'));",
        '      for (const el of elements) {',
        "        const text = el.textContent || '';",
        "        if (text.includes('\\\\begin{tikzcd}') || text.includes('\\\\begin{tikzpicture}')) {",
        '          code = text;',
        '          break;',
        '        }',
        '      }',
        '    }',
        '    const tikzcdMatch = code.match(/\\\\begin\\{tikzcd\\}[\\s\\S]*?\\\\end\\{tikzcd\\}/);',
        '    const tikzMatch = code.match(/\\\\begin\\{tikzpicture\\}[\\s\\S]*?\\\\end\\{tikzpicture\\}/);',
        '    const extracted = tikzcdMatch ? tikzcdMatch[0] : (tikzMatch ? tikzMatch[0] : code.trim());',
        '    ',
        "    if (extracted && (extracted.includes('\\\\begin{') || extracted.includes('\\\\draw'))) {",
        '      window.parent.postMessage({',
        "        type: 'diagram-export',",
        '        code: extracted',
        "      }, '*');",
        "      const statusEl = document.getElementById('pandoc-preview-status');",
        "      statusEl.innerText = 'Diagram exported successfully!';",
        "      statusEl.style.color = '#a6e3a1';",
        '    } else {',
        "      const statusEl = document.getElementById('pandoc-preview-status');",
        "      statusEl.innerText = 'Could not find TikZ/LaTeX code in tool output. Please trigger export inside the tool first.';",
        "      statusEl.style.color = '#f38ba8';",
        '    }',
        '  });',
        '</script>',
      ].join('\n');

      if (html.includes('</body>')) {
        html = html.replace('</body>', `${premiumOverlay}</body>`);
      } else {
        html = html + premiumOverlay;
      }

      res.type('html').send(html);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
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

      saveSessionState({
        last_file: targetPath,
        is_temp_file: false,
      });

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
    if (!targetPath || (typeof path !== 'string' && config.isTempFile)) {
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
