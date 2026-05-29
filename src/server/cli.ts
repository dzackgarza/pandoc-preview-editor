#!/usr/bin/env bun
import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { load } from 'js-toml';
import { startServer, type ServerConfig } from './index.js';

function expandTilde(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CliOptions {
  port?: string;
  host?: string;
  config?: string;
}

function parseConfig(found: string): ServerConfig | null {
  try {
    const raw = load(readFileSync(found, 'utf-8')) as Record<string, unknown>;
    const pandoc = (raw.pandoc ?? {}) as Record<string, unknown>;
    const render = (raw.render ?? {}) as Record<string, unknown>;
    const quickOpen = (raw.quick_open ?? {}) as Record<string, unknown>;

    if (
      typeof pandoc.render_command !== 'string' ||
      pandoc.render_command.trim() === ''
    ) {
      console.error(
        `${found} must specify a non-empty [pandoc] render_command.`,
      );
      return null;
    }

    return {
      renderCommand: pandoc.render_command as string,
      timeoutMs: typeof render.timeout_ms === 'number' ? render.timeout_ms : 30000,
      port: 3000,
      host: '127.0.0.1',
      configPath: found,
      templatesDir: resolve(
        expandTilde(
          typeof pandoc.templates_dir === 'string'
            ? pandoc.templates_dir
            : '~/.pandoc/templates',
        ),
      ),
      filtersDir: resolve(
        expandTilde(
          typeof pandoc.filters_dir === 'string'
            ? pandoc.filters_dir
            : '~/.pandoc/filters',
        ),
      ),
      debounceMs: typeof render.debounce_ms === 'number' ? render.debounce_ms : 750,
      launcherCommand:
        typeof quickOpen.launcher_command === 'string'
          ? quickOpen.launcher_command
          : undefined,
      restoreLastFile: typeof render.restore_last_file === 'boolean' ? render.restore_last_file : true,
    };
  } catch (err) {
    console.error(`Error reading or parsing config file at ${found}: ${err}`);
    return null;
  }
}

function loadConfig(configPath: string | undefined, cwd: string): ServerConfig | null {
  let found: string | undefined;

  if (configPath) {
    const resolvedPath = resolve(cwd, configPath);
    if (existsSync(resolvedPath)) {
      found = resolvedPath;
    } else {
      console.error(`Specified config file not found: ${resolvedPath}`);
      return null;
    }
  } else {
    // 1. Check local CWD override
    const localPath = resolve(cwd, 'pandoc-preview.toml');
    if (existsSync(localPath)) {
      found = localPath;
    } else {
      // 2. Resolve XDG-compliant config directory (Linux compat only)
      const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
      const xdgBaseDir = join(xdgConfigHome, 'pandoc-preview');
      const xdgCandidates = [
        join(xdgBaseDir, 'config.toml'),
        join(xdgBaseDir, 'pandoc-preview.toml'),
      ];

      found = xdgCandidates.find((p) => existsSync(p));

      if (!found) {
        // 3. Fallback: Initialize default config.toml in XDG directory
        const targetPath = join(xdgBaseDir, 'config.toml');
        try {
          mkdirSync(xdgBaseDir, { recursive: true });
          const defaultContent = `[render]
debounce_ms = 750
timeout_ms = 30000

[pandoc]
render_command = "pandoc --standalone --citeproc --mathjax --template=~/.pandoc/templates/pandoc_preview_template.html --lua-filter=~/.pandoc/filters/tikzcd.lua --lua-filter=~/.pandoc/filters/convert_amsthm_envs.lua -f markdown+tex_math_dollars+citations+wikilinks_title_after_pipe+tex_math_single_backslash -t html"
templates_dir = "~/.pandoc/templates"
filters_dir = "~/.pandoc/filters"
`;
          writeFileSync(targetPath, defaultContent, 'utf-8');
          console.log(`Initialized default configuration at: ${targetPath}`);
          found = targetPath;
        } catch (err) {
          console.error(`Failed to initialize default configuration at ${targetPath}: ${err}`);
          return null;
        }
      }
    }
  }

  if (!found) {
    console.error('Configuration could not be loaded or initialized.');
    return null;
  }

  return parseConfig(found);
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

    let fileContent: string | undefined;
    let absPath: string | undefined;
    let isTempFile = false;
    let recoveredFromBackup = false;

    let sessionRestored = false;
    if (!file && cfg.restoreLastFile) {
      try {
        if (existsSync(stateFilePath)) {
          const session = JSON.parse(readFileSync(stateFilePath, 'utf-8'));
          if (session && typeof session.last_file === 'string') {
            const lastFile = session.last_file;
            const isTemp = !!session.is_temp_file;
            const backupPath = getBackupPath(lastFile);

            if ((isTemp && existsSync(backupPath)) || (!isTemp && (existsSync(lastFile) || existsSync(backupPath)))) {
              absPath = lastFile;
              isTempFile = isTemp;
              sessionRestored = true;

              if (existsSync(backupPath)) {
                fileContent = readFileSync(backupPath, 'utf-8');
                recoveredFromBackup = true;
                console.log(`Restored unsaved session from backup: ${backupPath}`);
              } else if (existsSync(lastFile)) {
                fileContent = readFileSync(lastFile, 'utf-8');
              }
            }
          }
        }
      } catch (err) {
        console.error(`Failed to restore last session: ${err}`);
      }
    }

    if (!sessionRestored) {
      if (file) {
        absPath = resolve(cwd, file);
        try {
          fileContent = readFileSync(absPath, 'utf-8');
          const backupPath = getBackupPath(absPath);
          if (existsSync(backupPath)) {
            fileContent = readFileSync(backupPath, 'utf-8');
            recoveredFromBackup = true;
            console.log(`Recovered unsaved edits from backup for: ${absPath}`);
          }
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
    }

    if (absPath) {
      saveSessionState({
        last_file: absPath,
        is_temp_file: isTempFile,
      });
    }

    const config: ServerConfig = {
      ...cfg,
      file: absPath,
      fileContent,
      workspaceRoot: absPath ? dirname(absPath) : cwd,
      isTempFile,
      recoveredFromBackup,
    };

    startServer(config);

    if (file && absPath) {
      console.log(`File: ${absPath}`);
    } else if (absPath) {
      console.log(`Recovery file: ${absPath}`);
    }
  });

program.parse();
