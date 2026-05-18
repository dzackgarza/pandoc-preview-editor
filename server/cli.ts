#!/usr/bin/env node
import { startServer } from './index.js';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`pandoc-nvim-preview — local Pandoc writing workbench with real Neovim

Usage:
  pandoc-nvim-preview <file.md> [options]

Options:
  --port <N>           Port to listen on (default: 3141)
  --bibliography <bib> Path to bibliography file for citeproc
  --csl <file>         Path to CSL citation style file
  --katex              Use KaTeX instead of MathJax for math rendering
  --no-open            Don't auto-open browser
  --help, -h           Show this help

Examples:
  pandoc-nvim-preview notes.md
  pandoc-nvim-preview paper.md --bibliography refs.bib
  pandoc-nvim-preview math-notes.md --katex
`);
  process.exit(0);
}

let filePath = args[0];
let port = 3141;
let bibliography: string | undefined;
let csl: string | undefined;
let katex = false;
let noOpen = false;

for (let i = 1; i < args.length; i++) {
  switch (args[i]) {
    case '--port':
      port = parseInt(args[++i], 10);
      break;
    case '--bibliography':
      bibliography = args[++i];
      break;
    case '--csl':
      csl = args[++i];
      break;
    case '--katex':
      katex = true;
      break;
    case '--no-open':
      noOpen = true;
      break;
  }
}

process.env.PORT = String(port);
if (bibliography) process.env.BIBLIOGRAPHY = bibliography;
if (csl) process.env.CSL = csl;
if (katex) process.env.KATEX = '1';
if (noOpen) process.env.NO_OPEN = '1';

const absPath = resolve(filePath);

startServer({
  filePath: absPath,
  port,
  bibliography,
  csl,
  katex,
}).catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
