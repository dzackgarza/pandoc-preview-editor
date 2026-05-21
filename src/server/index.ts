import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findPlugin,
  loadBundledPlugins,
  pluginMetadata,
  runPlugin,
} from './plugins.js';
import { renderMarkdown } from './render.js';
import {
  compareEntries,
  isTextLikeFile,
  resolveInside,
  shouldIgnore,
  toClientPath,
  type FileTreeEntry,
} from './workspace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_CLIENT_DIR = resolve(__dirname, '..', 'client');
const BUILT_CLIENT_DIR = resolve(process.cwd(), 'dist', 'client');

function currentFileContent(config: ServerConfig): string {
  if (config.file && existsSync(config.file)) {
    return readFileSync(config.file, 'utf-8');
  }
  return config.fileContent ?? '';
}

export interface ServerConfig {
  pandocCommand: string;
  pandocArgs: string[];
  timeoutMs: number;
  port: number;
  host: string;
  file?: string;
  fileContent?: string;
  workspaceRoot?: string;
  isTempFile?: boolean;
}

export function createApp(config: ServerConfig) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const clientDir = getClientDir();
  const workspaceRoot = resolve(
    config.workspaceRoot ?? dirname(config.file ?? process.cwd()),
  );
  const plugins = loadBundledPlugins();

  // Serve index.html with inlined initial content if a file was specified
  // (must be before express.static to intercept / before it serves index.html raw)
  app.get('/', (_req, res) => {
    const indexPath = resolve(clientDir, 'index.html');
    let html = readFileSync(indexPath, 'utf-8');

    const initialScript = [
      `window.__INITIAL_CONTENT = ${safeJson(currentFileContent(config))};`,
      `window.__INITIAL_FILE = ${safeJson(config.file ?? null)};`,
      `window.__WORKSPACE_ROOT = ${safeJson(workspaceRoot)};`,
      `window.__IS_TEMP_FILE = ${safeJson(config.isTempFile ?? false)};`,
    ].join(' ');
    html = html.replace('</head>', `<script>${initialScript}<\/script></head>`);

    res.type('html').send(html);
  });

  // Serve other static files from client directory
  app.use(express.static(clientDir));

  // Pandoc render endpoint
  app.post<{ html: string; durationMs: number }>('/api/render', async (req, res) => {
    const { markdown } = req.body as {
      markdown?: unknown;
    };
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown field is required' });
      return;
    }

    const result = await renderMarkdown(
      markdown,
      config.pandocCommand,
      config.pandocArgs,
      config.timeoutMs,
    );

    res.json({
      html: result.html,
      durationMs: result.durationMs,
      ok: result.ok,
      stderr: result.stderr,
    });
  });

  // Save endpoint
  app.post<{ markdown: string; path?: string }>('/api/save', async (req, res) => {
    const { markdown, path } = req.body;
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown field is required' });
      return;
    }
    // Resolve workspace-relative paths, absolute paths, or use configured file
    let targetPath: string | undefined;
    if (typeof path === 'string' && path.length > 0) {
      try {
        targetPath = resolveInside(workspaceRoot, path);
      } catch {
        // path may be an absolute path outside workspace; use as-is
        targetPath = path;
      }
    } else {
      targetPath = config.file;
    }
    if (!targetPath) {
      res.status(400).json({ error: 'no file path configured or provided' });
      return;
    }
    try {
      writeFileSync(targetPath, markdown, 'utf-8');
      res.json({ ok: true, path: targetPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/files', (req, res) => {
    const requestedDir = typeof req.query.dir === 'string' ? req.query.dir : '';

    try {
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

  app.get('/api/files/content', (req, res) => {
    const requestedPath = typeof req.query.path === 'string' ? req.query.path : '';

    try {
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

  app.post('/api/files/new', (req, res) => {
    try {
      const { path: requestedPath } = req.body as { path?: string };
      let targetPath: string;
      if (typeof requestedPath === 'string' && requestedPath.length > 0) {
        targetPath = resolveInside(workspaceRoot, requestedPath);
      } else {
        targetPath = resolveInside(workspaceRoot, `untitled-${randomUUID()}.md`);
      }
      writeFileSync(targetPath, '', { encoding: 'utf-8', flag: 'wx' });
      res.json({
        ok: true,
        path: toClientPath(workspaceRoot, targetPath),
        absolutePath: targetPath,
        content: '',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/plugins', (_req, res) => {
    res.json({ plugins: plugins.map(pluginMetadata) });
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
    if (!targetPath) {
      res
        .status(400)
        .json({ ok: false, error: 'no file path: save the document first' });
      return;
    }

    try {
      writeFileSync(targetPath, markdown, 'utf-8');
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

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}
