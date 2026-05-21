import { Command } from 'commander';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { load } from 'js-toml';
import { startServer, type ServerConfig } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function expandTildePaths(args: string[]): string[] {
  const home = homedir();
  return args.map((arg) => {
    if (arg.startsWith('~/') || arg === '~') {
      return home + arg.slice(1);
    }
    return arg;
  });
}

interface CliOptions {
  port?: string;
  host?: string;
  config?: string;
}

function loadConfig(configPath: string | undefined, cwd: string): ServerConfig | null {
  const candidates = configPath
    ? [resolve(cwd, configPath)]
    : [resolve(cwd, 'pandoc-preview.toml')];

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error('No pandoc-preview.toml found. Configuration is required.');
    return null;
  }

  const raw = load(readFileSync(found, 'utf-8')) as Record<string, unknown>;
  const pandoc = (raw.pandoc ?? {}) as Record<string, unknown>;
  const render = (raw.render ?? {}) as Record<string, unknown>;

  if (typeof pandoc.command !== 'string' || !Array.isArray(pandoc.args)) {
    console.error('pandoc-preview.toml must specify [pandoc] command and args.');
    return null;
  }

  return {
    pandocCommand: pandoc.command as string,
    pandocArgs: expandTildePaths(pandoc.args as string[]),
    timeoutMs: typeof render.timeout_ms === 'number' ? render.timeout_ms : 30000,
    port: 3000,
    host: '127.0.0.1',
  };
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
    const cfg = loadConfig(options.config, cwd);
    if (!cfg) {
      process.exit(1);
    }

    cfg.port = parseInt(options.port ?? '3000', 10);
    cfg.host = options.host ?? '127.0.0.1';

    let fileContent: string | undefined;
    let absPath: string | undefined;
    let isTempFile = false;
    if (file) {
      absPath = resolve(cwd, file);
      try {
        fileContent = readFileSync(absPath, 'utf-8');
      } catch (err) {
        console.error(`Warning: could not read file ${absPath}: ${err}`);
      }
    } else {
      const tmpDir = join(tmpdir(), 'pandoc-preview');
      mkdirSync(tmpDir, { recursive: true });
      absPath = join(tmpDir, `untitled-${randomUUID()}.md`);
      fileContent = '';
      isTempFile = true;
    }

    const config: ServerConfig = {
      ...cfg,
      file: absPath,
      fileContent,
      workspaceRoot: file && absPath ? dirname(absPath) : cwd,
      isTempFile,
    };

    startServer(config);

    if (file && absPath) {
      console.log(`File: ${absPath}`);
    }
  });

program.parse();
