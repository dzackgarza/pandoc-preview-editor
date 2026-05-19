#!/usr/bin/env node
import { Command } from 'commander';
import { startServer } from './index.js';
import { applyCliPandocOverrides, loadPreviewConfig } from './config.js';
import { resolve } from 'node:path';

const DEFAULT_PORT = 3141;

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

const program = new Command()
  .name('pandoc-nvim-preview')
  .description('Local Pandoc writing workbench with real Neovim')
  .argument('<file>', 'Markdown file to edit')
  .option('--port <port>', 'HTTP port to listen on', parsePort, DEFAULT_PORT)
  .option('--config <file>', 'Path to pandoc-preview TOML config file')
  .option('--bibliography <bib>', 'Path to bibliography file for citeproc')
  .option('--csl <file>', 'Path to CSL citation style file')
  .option('--katex', 'Use KaTeX instead of MathJax for math rendering')
  .option('--no-open', "Don't auto-open browser")
  .addHelpText('after', `\nDefault server port: ${DEFAULT_PORT}.`)
  .parse();

const opts = program.opts();
const filePath = resolve(program.args[0]);
const port = opts.port as number;
const previewConfig = applyCliPandocOverrides(
  loadPreviewConfig(filePath, opts.config),
  {
    bibliography: opts.bibliography,
    csl: opts.csl,
    katex: opts.katex,
  },
);

if (!opts.open) process.env.NO_OPEN = '1';

startServer({
  filePath,
  port,
  previewConfig,
}).catch((err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Fatal: Port ${port} is already in use. Is another instance already running?`);
  } else {
    console.error('Fatal:', err.message);
  }
  process.exit(1);
});
