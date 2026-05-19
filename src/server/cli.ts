import { Command } from 'commander';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { load } from 'js-toml';
import { startServer, type ServerConfig } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ARGS = [
  '-f',
  'markdown+tex_math_dollars+citations',
  '-t',
  'html',
  '--mathjax',
];

interface CliOptions {
  port?: string;
  host?: string;
  config?: string;
}

function loadConfig(
  configPath: string | undefined,
  cwd: string,
): Partial<ServerConfig> {
  const candidates = configPath
    ? [resolve(cwd, configPath)]
    : [resolve(cwd, 'pandoc-preview.toml')];

  const found = candidates.find((p) => existsSync(p));
  if (!found) return {};

  const raw = load(readFileSync(found, 'utf-8')) as Record<string, unknown>;
  const pandoc = (raw.pandoc ?? {}) as Record<string, unknown>;
  const render = (raw.render ?? {}) as Record<string, unknown>;

  const cfg: Partial<ServerConfig> = {};
  if (typeof pandoc.command === 'string') cfg.pandocCommand = pandoc.command;
  if (Array.isArray(pandoc.args)) cfg.pandocArgs = pandoc.args as string[];
  if (typeof render.timeout_ms === 'number') cfg.timeoutMs = render.timeout_ms;
  return cfg;
}

const program = new Command();

program
  .name('pandoc-preview')
  .description('Pandoc preview server with textarea editor')
  .argument('[file]', 'File to open (optional)')
  .option('-p, --port <port>', 'Server port', '3000')
  .option('--host <host>', 'Server host', '127.0.0.1')
  .option('-c, --config <path>', 'Config file path')
  .action((file: string | undefined, options: CliOptions) => {
    const cwd = process.cwd();
    const configOverrides = loadConfig(options.config, cwd);

    // Determine file path and initial content
    let fileContent: string | undefined;
    let absPath: string | undefined;
    if (file) {
      absPath = resolve(cwd, file);
      try {
        fileContent = readFileSync(absPath, 'utf-8');
      } catch (err) {
        console.error(`Warning: could not read file ${absPath}: ${err}`);
      }
    } else {
      // No file arg — create a default temp path so the client always has one
      const tmpDir = join(tmpdir(), 'pandoc-preview');
      mkdirSync(tmpDir, { recursive: true });
      absPath = join(tmpDir, `untitled-${randomUUID()}.md`);
      fileContent = '';
    }

    const config: ServerConfig = {
      pandocCommand: configOverrides.pandocCommand ?? 'pandoc',
      pandocArgs: configOverrides.pandocArgs ?? DEFAULT_ARGS,
      timeoutMs: configOverrides.timeoutMs ?? 30000,
      port: parseInt(options.port ?? '3000', 10),
      host: options.host ?? '127.0.0.1',
      file: absPath,
      fileContent,
      workspaceRoot: file && absPath ? dirname(absPath) : cwd,
    };

    startServer(config);

    if (file && absPath) {
      console.log(`File: ${absPath}`);
    }
  });

program.parse();
