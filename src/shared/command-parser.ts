import minimist from 'minimist';
import { parse, quote } from 'shell-quote';

export function tokenize(command: string): string[] {
  return parse(command).filter((t): t is string => typeof t === 'string');
}

export interface ParsedFlags {
  commandName: string;
  standalone: boolean;
  citeproc: boolean;
  toc: boolean;
  numberSections: boolean;
  embedResources: boolean;
  math: 'mathjax' | 'katex' | 'webtex' | 'none';
  selectedTemplate: string;
  selectedFilters: string[];
  otherFlags: string[];
}

export function parseCommand(command: string): ParsedFlags {
  const tokens = tokenize(command);
  const [commandName = 'pandoc', ...rest] = tokens;

  const parsed = minimist(rest, {
    string: ['template', 'lua-filter', 'filter'],
    boolean: [
      'standalone',
      'citeproc',
      'toc',
      'number-sections',
      'embed-resources',
      'mathjax',
      'katex',
      'webtex',
    ],
    alias: {
      s: 'standalone',
      N: 'number-sections',
      toc: 'table-of-contents',
    },
    default: {},
    stopEarly: false,
  });

  const rawTemplate = pickLast(parsed.template);
  const selectedTemplate = rawTemplate
    ? rawTemplate.startsWith('/') || rawTemplate.startsWith('~/')
      ? rawTemplate
      : rawTemplate.split('/').at(-1) || rawTemplate
    : '';

  const rawLuaFilters = toArray(parsed['lua-filter']);
  const rawFilters = toArray(parsed.filter);
  const selectedFilters = [...rawLuaFilters, ...rawFilters].map((f) => {
    if (f.startsWith('/') || f.startsWith('~/')) return f;
    return f.split('/').at(-1) || f;
  });

  let math: ParsedFlags['math'] = 'none';
  if (parsed.webtex) math = 'webtex';
  if (parsed.katex) math = 'katex';
  if (parsed.mathjax) math = 'mathjax';

  const knownFlags = new Set([
    'standalone',
    'citeproc',
    'toc',
    'number-sections',
    'embed-resources',
    'mathjax',
    'katex',
    'webtex',
    'template',
    'lua-filter',
    'filter',
    's',
    'N',
    '_',
  ]);
  const otherFlags: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (knownFlags.has(key)) continue;
    if (key.startsWith('_')) continue;
    if (typeof value === 'boolean') {
      if (value) otherFlags.push(`--${key}`);
    } else if (Array.isArray(value)) {
      for (const v of value) otherFlags.push(`--${key}=${v}`);
    } else {
      otherFlags.push(`--${key}=${value}`);
    }
  }

  return {
    commandName,
    standalone: !!parsed.standalone,
    citeproc: !!parsed.citeproc,
    toc: !!parsed.toc,
    numberSections: !!parsed['number-sections'],
    embedResources: !!parsed['embed-resources'],
    math,
    selectedTemplate,
    selectedFilters,
    otherFlags,
  };
}

export function buildCommand(
  flags: ParsedFlags,
  templatesDir: string,
  filtersDir: string,
): string {
  const args: string[] = [];
  if (flags.standalone) args.push('--standalone');
  if (flags.citeproc) args.push('--citeproc');
  if (flags.toc) args.push('--table-of-contents');
  if (flags.numberSections) args.push('--number-sections');
  if (flags.embedResources) args.push('--embed-resources');
  if (flags.math === 'mathjax') args.push('--mathjax');
  if (flags.math === 'katex') args.push('--katex');
  if (flags.math === 'webtex') args.push('--webtex');
  if (flags.selectedTemplate) {
    if (
      flags.selectedTemplate.startsWith('/') ||
      flags.selectedTemplate.startsWith('~/')
    ) {
      args.push(`--template=${flags.selectedTemplate}`);
    } else {
      args.push(
        `--template=${templatesDir.replace(/\/$/, '')}/${flags.selectedTemplate}`,
      );
    }
  }
  for (const filter of flags.selectedFilters) {
    const ext = filter.endsWith('.lua') ? '--lua-filter' : '--filter';
    if (filter.startsWith('/') || filter.startsWith('~/')) {
      args.push(`${ext}=${filter}`);
    } else {
      args.push(`${ext}=${filtersDir.replace(/\/$/, '')}/${filter}`);
    }
  }
  args.push(...flags.otherFlags);
  return quote([flags.commandName, ...args]);
}

function toArray(value: any): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return [String(value)];
}

function pickLast(value: any): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.at(-1) ?? null;
  return String(value);
}
