import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_CLIENT_DIR = resolve(__dirname, '..', 'client');
const BUILT_CLIENT_DIR = resolve(process.cwd(), 'dist', 'client');

export interface ServerConfig {
  pandocCommand: string;
  pandocArgs: string[];
  timeoutMs: number;
  port: number;
  host: string;
  file?: string;
  fileContent?: string;
  workspaceRoot?: string;
}

const DEFAULT_ARGS = [
  '-f',
  'markdown+tex_math_dollars+citations',
  '-t',
  'html',
  '--standalone',
  '--mathjax',
];

export function createApp(config: ServerConfig) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const clientDir = getClientDir();
  const workspaceRoot = resolve(config.workspaceRoot ?? dirname(config.file ?? process.cwd()));

  // Serve index.html with inlined initial content if a file was specified
  // (must be before express.static to intercept / before it serves index.html raw)
  app.get('/', (_req, res) => {
    const indexPath = resolve(clientDir, 'index.html');
    let html = readFileSync(indexPath, 'utf-8');

    const initialScript = [
      `window.__INITIAL_CONTENT = ${safeJson(config.fileContent ?? '')};`,
      `window.__INITIAL_FILE = ${safeJson(config.file ?? null)};`,
      `window.__WORKSPACE_ROOT = ${safeJson(workspaceRoot)};`,
    ].join(' ');
    html = html.replace('</head>', `<script>${initialScript}<\/script></head>`);

    res.type('html').send(html);
  });

  // Serve other static files from client directory
  app.use(express.static(clientDir));

  // Pandoc render endpoint
  app.post<{ html: string; durationMs: number }>('/api/render', async (req, res) => {
    const { markdown } = req.body;
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

    res.json({ html: result.html, durationMs: result.durationMs, ok: result.ok });
  });

  // Save endpoint
  app.post<{ markdown: string; path?: string }>('/api/save', async (req, res) => {
    const { markdown, path } = req.body;
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown field is required' });
      return;
    }
    // Use explicit path if provided, otherwise the configured file path
    const targetPath = path || config.file;
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

  app.post('/api/files/new', (_req, res) => {
    try {
      const targetPath = resolveInside(workspaceRoot, `untitled-${randomUUID()}.md`);
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

  return app;
}

export function startServer(config: ServerConfig) {
  const app = createApp(config);
  app.listen(config.port, config.host, () => {
    const url = `http://${config.host}:${config.port}`;
    console.log(`pandoc-preview running at ${url}`);
  });
}

// Run directly
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  startServer({
    pandocCommand: 'pandoc',
    pandocArgs: DEFAULT_ARGS,
    timeoutMs: 30000,
    port,
    host: '127.0.0.1',
    workspaceRoot: process.cwd(),
  });
}

type FileTreeEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
};

const IGNORE_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const TEXT_EXTENSIONS = new Set([
  '.bib',
  '.css',
  '.csv',
  '.htm',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.lua',
  '.md',
  '.mdown',
  '.markdown',
  '.mjs',
  '.rst',
  '.sh',
  '.tex',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avif',
  '.bin',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.tar',
  '.tgz',
  '.webp',
  '.zip',
  '.zst',
]);

function getClientDir() {
  if (existsSync(resolve(BUILT_CLIENT_DIR, 'index.html'))) {
    return BUILT_CLIENT_DIR;
  }
  return SOURCE_CLIENT_DIR;
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function resolveInside(root: string, pathFromClient: string) {
  const target = resolve(root, pathFromClient || '.');
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path escapes workspace root');
  }
  return target;
}

function toClientPath(root: string, absolutePath: string) {
  return relative(root, absolutePath).split(sep).join('/');
}

function shouldIgnore(root: string, absolutePath: string) {
  const rel = toClientPath(root, absolutePath);
  if (rel === 'archive/test-results' || rel.startsWith('archive/test-results/')) {
    return true;
  }
  return rel.split('/').some((part) => IGNORE_NAMES.has(part));
}

function isTextLikeFile(absolutePath: string) {
  const name = absolutePath.split(sep).at(-1)?.toLowerCase() ?? '';
  if (name === 'justfile') return true;

  const ext = extname(name);
  if (BINARY_EXTENSIONS.has(ext)) return false;
  if (TEXT_EXTENSIONS.has(ext)) return true;

  try {
    const sample = readFileSync(absolutePath).subarray(0, 1024);
    return !sample.includes(0);
  } catch {
    return false;
  }
}

function compareEntries(a: FileTreeEntry, b: FileTreeEntry) {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name);
}
