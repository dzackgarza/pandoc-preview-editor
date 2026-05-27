import { Command } from 'commander';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { load } from 'js-toml';
import { parse } from 'shell-quote';
import { startServer, type ServerConfig } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function expandTildePaths(args: string[]): string[] {
  const home = homedir();
  return args.map((arg) => {
    // Expand standalone ~/, ~, and ~/ after =
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

  if (typeof pandoc.render_command !== 'string') {
    console.error('pandoc-preview.toml must specify [pandoc] render_command.');
    return null;
  }

  const parsed = parse(pandoc.render_command as string).filter(
    (entry): entry is string => typeof entry === 'string',
  );
  if (parsed.length === 0) {
    console.error(
      'pandoc-preview.toml [pandoc] render_command must be a non-empty shell command.',
    );
    return null;
  }

  return {
    renderCommand: expandTildePaths(parsed),
    timeoutMs: typeof render.timeout_ms === 'number' ? render.timeout_ms : 30000,
    port: 3000,
    host: '127.0.0.1',
    configPath: found,
    templatesDir:
      typeof pandoc.templates_dir === 'string'
        ? pandoc.templates_dir
        : '~/.pandoc/templates',
    filtersDir:
      typeof pandoc.filters_dir === 'string' ? pandoc.filters_dir : '~/.pandoc/filters',
    debounceMs: typeof render.debounce_ms === 'number' ? render.debounce_ms : 750,
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
    } else if (absPath) {
      console.log(`Recovery file: ${absPath}`);
    }
  });

program.parse();
