import { spawnSync } from 'node:child_process';

export interface RenderOptions {
  bibliography?: string;
  csl?: string;
  katex?: boolean;
}

export function renderMarkdown(markdown: string, options: RenderOptions = {}): string {
  const args = [
    '-f',
    'markdown+tex_math_dollars+citations',
    '-t',
    'html',
    '--standalone',
    '--citeproc',
  ];

  if (options.katex) {
    args.push('--katex');
  } else {
    args.push('--mathjax');
  }

  if (options.bibliography) {
    args.push('--bibliography', options.bibliography);
  }

  if (options.csl) {
    args.push('--csl', options.csl);
  }

  const result = spawnSync('pandoc', args, {
    input: markdown,
    encoding: 'utf-8',
    timeout: 5000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    return `<!-- pandoc error: ${result.error.message} -->`;
  }

  if (result.status !== 0) {
    return `<!-- pandoc error:\n${result.stderr}\n-->`;
  }

  return result.stdout;
}
