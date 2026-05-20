import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-toml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(__dirname, 'plugins');

export type PluginManifest = {
  id: string;
  name: string;
  description: string;
  category: string;
  command: string;
  args: string[];
  output?: string;
  timeoutMs?: number;
};

export type PluginMetadata = Pick<
  PluginManifest,
  'id' | 'name' | 'description' | 'category'
>;

export type PluginRunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  outputPath?: string;
};

export function loadBundledPlugins(): PluginManifest[] {
  if (!existsSync(PLUGIN_DIR)) return [];

  return readdirSync(PLUGIN_DIR)
    .filter((name) => name.endsWith('.toml'))
    .sort()
    .map((name) => loadPluginFile(resolve(PLUGIN_DIR, name)));
}

export function pluginMetadata(plugin: PluginManifest): PluginMetadata {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    category: plugin.category,
  };
}

export function findPlugin(plugins: PluginManifest[], id: string) {
  return plugins.find((plugin) => plugin.id === id);
}

export function runPlugin(
  plugin: PluginManifest,
  filePath: string,
  defaultTimeoutMs: number,
): Promise<PluginRunResult> {
  const startedArgs = plugin.args.map((arg) => interpolate(arg, filePath));
  const outputPath = plugin.output ? interpolate(plugin.output, filePath) : undefined;
  const timeoutMs = plugin.timeoutMs ?? defaultTimeoutMs;

  return new Promise((resolveRun) => {
    const child = spawn(plugin.command, startedArgs, {
      cwd: dirname(filePath),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolveRun({
        ok: false,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: `plugin timed out after ${timeoutMs}ms`,
        exitCode: null,
        outputPath,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveRun({
        ok: false,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: err.message,
        exitCode: null,
        outputPath,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveRun({
        ok: code === 0,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
        exitCode: code,
        outputPath,
      });
    });
  });
}

function loadPluginFile(path: string): PluginManifest {
  const raw = load(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const plugin = {
    id: readString(raw, 'id', path),
    name: readString(raw, 'name', path),
    description: readString(raw, 'description', path),
    category: readString(raw, 'category', path),
    command: readString(raw, 'command', path),
    args: readStringArray(raw, 'args', path),
    output: typeof raw.output === 'string' ? raw.output : undefined,
    timeoutMs: typeof raw.timeout_ms === 'number' ? raw.timeout_ms : undefined,
  };

  if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.id)) {
    throw new Error(`plugin ${path} has invalid id "${plugin.id}"`);
  }

  return plugin;
}

function readString(raw: Record<string, unknown>, key: string, path: string) {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`plugin ${path} must specify string field ${key}`);
  }
  return value;
}

function readStringArray(raw: Record<string, unknown>, key: string, path: string) {
  const value = raw[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`plugin ${path} must specify string array field ${key}`);
  }
  return value as string[];
}

function interpolate(template: string, filePath: string) {
  const ext = extname(filePath);
  const vars: Record<string, string> = {
    FILE: filePath,
    FILE_DIR: dirname(filePath),
    FILE_NAME: basename(filePath),
    FILE_STEM: basename(filePath, ext),
    FILE_EXT: ext,
  };

  return template.replace(/\$\{(\w+)\}/g, (match, name: string) => {
    return vars[name] ?? match;
  });
}
