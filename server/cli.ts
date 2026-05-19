#!/usr/bin/env node
import { Command } from 'commander';
import { startServer } from './index.js';
import { resolve } from 'node:path';

const PORT = 3141;

const program = new Command()
  .name('pandoc-nvim-preview')
  .description('Local Pandoc writing workbench with real Neovim')
  .argument('<file>', 'Markdown file to edit')
  .option('--bibliography <bib>', 'Path to bibliography file for citeproc')
  .option('--csl <file>', 'Path to CSL citation style file')
  .option('--katex', 'Use KaTeX instead of MathJax for math rendering')
  .option('--no-open', "Don't auto-open browser")
  .addHelpText('after', `\nServer runs on port ${PORT}. Only one instance can run at a time.`)
  .parse();

const opts = program.opts();
const filePath = resolve(program.args[0]);

if (!opts.open) process.env.NO_OPEN = '1';

startServer({
  filePath,
  port: PORT,
  bibliography: opts.bibliography,
  csl: opts.csl,
  katex: opts.katex,
}).catch((err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Fatal: Port ${PORT} is already in use. Is another instance already running?`);
  } else {
    console.error('Fatal:', err.message);
  }
  process.exit(1);
});
