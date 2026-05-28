import { readFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type FileTreeEntry = {
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
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdown', '.markdown']);
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

export function resolveInside(root: string, pathFromClient: string) {
  const target = resolve(root, pathFromClient || '.');
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path escapes workspace root');
  }
  return target;
}

export function toClientPath(root: string, absolutePath: string) {
  return relative(root, absolutePath).split(sep).join('/');
}

export function shouldIgnore(root: string, absolutePath: string) {
  const rel = toClientPath(root, absolutePath);
  if (rel === 'archive/test-results' || rel.startsWith('archive/test-results/')) {
    return true;
  }
  return rel.split('/').some((part) => IGNORE_NAMES.has(part));
}

export function isTextLikeFile(absolutePath: string) {
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

export function isMarkdownFile(absolutePath: string) {
  return MARKDOWN_EXTENSIONS.has(extname(absolutePath).toLowerCase());
}

export function compareEntries(a: FileTreeEntry, b: FileTreeEntry) {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function writeFileSyncAtomic(targetPath: string, content: string): void {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  const tempPath = join(dir, `.${base}.tmp.${randomUUID()}`);

  let fd: number | null = null;
  try {
    fd = openSync(tempPath, 'w');
    writeSync(fd, content, null, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, targetPath);
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {}
    }
    throw err;
  }
}
