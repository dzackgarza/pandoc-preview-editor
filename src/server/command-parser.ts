import minimist from 'minimist';
import { parse, quote } from 'shell-quote';

/**
 * Tokenize a shell command string into an array of tokens.
 * Uses shell-quote for proper quoting/escaping handling.
 */
export function tokenize(command: string): string[] {
  return parse(command).filter((t): t is string => typeof t === 'string');
}

/**
 * Parsed flags from a Pandoc command string.
 */
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

/**
 * Parse a Pandoc command string into structured flag data.
 * Uses minimist instead of hand-walking tokens.
 */
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
    // Don't stop at first non-flag argument
    stopEarly: false,
  });

  // Extract template (take last one if multiple)
  const rawTemplate = pickLast(parsed.template);
  const selectedTemplate = rawTemplate
    ? rawTemplate.split('/').at(-1) || rawTemplate
    : '';

  // Extract filters (both --lua-filter and --filter)
  const rawLuaFilters = toArray(parsed['lua-filter']);
  const rawFilters = toArray(parsed.filter);
  const selectedFilters = [...rawLuaFilters, ...rawFilters].map(
    (f) => f.split('/').at(-1) || f,
  );

  // Determine math engine (last one wins)
  let math: ParsedFlags['math'] = 'none';
  if (parsed.webtex) math = 'webtex';
  if (parsed.katex) math = 'katex';
  if (parsed.mathjax) math = 'mathjax';

  // Collect unknown flags as otherFlags
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
    '_', // minimist puts positional args here
  ]);
  const otherFlags: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (knownFlags.has(key)) continue;
    if (key.startsWith('_')) continue;
    // Convert back to --flag form
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
    standalone: parsed.standalone,
    citeproc: parsed.citeproc,
    toc: parsed.toc,
    numberSections: parsed['number-sections'],
    embedResources: parsed['embed-resources'],
    math,
    selectedTemplate,
    selectedFilters,
    otherFlags,
  };
}

/**
 * Rebuild a shell command string from parsed flag data.
 */
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
    args.push(
      `--template=${templatesDir.replace(/\/$/, '')}/${flags.selectedTemplate}`,
    );
  }
  for (const filter of flags.selectedFilters) {
    const ext = filter.endsWith('.lua') ? '--lua-filter' : '--filter';
    args.push(`${ext}=${filtersDir.replace(/\/$/, '')}/${filter}`);
  }
  args.push(...flags.otherFlags);
  return quote([flags.commandName, ...args]);
}

/**
 * Extract all filter paths (--lua-filter and --filter) from a command string.
 * Returns the raw paths as they appear in the command (not resolved).
 */
export function extractFilterPaths(command: string): string[] {
  const tokens = tokenize(command);
  const paths: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const arg = tokens[i];
    if (arg.startsWith('--lua-filter=')) {
      paths.push(arg.slice('--lua-filter='.length));
    } else if (arg === '--lua-filter' && i + 1 < tokens.length) {
      paths.push(tokens[++i]);
    } else if (arg.startsWith('--filter=')) {
      paths.push(arg.slice('--filter='.length));
    } else if (arg === '--filter' && i + 1 < tokens.length) {
      paths.push(tokens[++i]);
    }
  }

  return paths;
}

/**
 * Remove filter flags from a command string.
 * Keeps filters whose resolved path is NOT inside filtersDir.
 * Returns the remaining tokens as a string array (for re-serialization).
 */
export function removeFilterFlags(command: string, filtersDir: string): string[] {
  const tokens = tokenize(command);
  const result: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const arg = tokens[i];
    let filterPath: string | null = null;
    let isPair = false;

    if (arg.startsWith('--lua-filter=')) {
      filterPath = arg.slice('--lua-filter='.length);
    } else if (arg === '--lua-filter' && i + 1 < tokens.length) {
      filterPath = tokens[++i];
      isPair = true;
    } else if (arg.startsWith('--filter=')) {
      filterPath = arg.slice('--filter='.length);
    } else if (arg === '--filter' && i + 1 < tokens.length) {
      filterPath = tokens[++i];
      isPair = true;
    }

    if (filterPath) {
      // Keep filters whose parent is NOT the filters directory
      const resolved = resolvePath(filterPath);
      const absFiltersDir = resolvePath(filtersDir);
      if (dirname(resolved) === absFiltersDir) {
        // Skip — this filter is inside the filters directory
        continue;
      }
      // Keep — this filter is outside the filters directory
      result.push(arg);
      if (isPair) result.push(tokens[i]);
      continue;
    }

    result.push(arg);
  }

  return result;
}

/**
 * Validate that template and filter paths are inside their allowed directories.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateCommandPaths(
  command: string,
  templatesDir: string,
  filtersDir: string,
): { valid: boolean; error?: string } {
  const tokens = tokenize(command);
  const absTemplatesDir = resolvePath(templatesDir);
  const absFiltersDir = resolvePath(filtersDir);

  for (let i = 1; i < tokens.length; i++) {
    const arg = tokens[i];
    let templatePath: string | null = null;
    let filterPath: string | null = null;

    if (arg.startsWith('--template=')) {
      templatePath = arg.slice('--template='.length);
    } else if (arg === '--template' && i + 1 < tokens.length) {
      templatePath = tokens[++i];
    } else if (arg.startsWith('--lua-filter=')) {
      filterPath = arg.slice('--lua-filter='.length);
    } else if (arg === '--lua-filter' && i + 1 < tokens.length) {
      filterPath = tokens[++i];
    } else if (arg.startsWith('--filter=')) {
      filterPath = arg.slice('--filter='.length);
    } else if (arg === '--filter' && i + 1 < tokens.length) {
      filterPath = tokens[++i];
    }

    if (templatePath) {
      const resolved = resolvePath(templatePath);
      if (dirname(resolved) !== absTemplatesDir) {
        return {
          valid: false,
          error: `Template file '${basename(templatePath)}' is external. Please place it in the templates directory first so the app can discover it.`,
        };
      }
    }

    if (filterPath) {
      const resolved = resolvePath(filterPath);
      if (dirname(resolved) !== absFiltersDir) {
        return {
          valid: false,
          error: `Filter file '${basename(filterPath)}' is external. Please place it in the filters directory first so the app can discover it.`,
        };
      }
    }
  }

  return { valid: true };
}

// ── Internal helpers ──────────────────────────────────────────────────

function toArray(value: string | string | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function pickLast(value: string | string | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.at(-1) ?? null;
  return value;
}

// Minimal path helpers to avoid importing node:path in this module.
// These are intentionally simple — they handle the cases the app needs.
function resolvePath(p: string): string {
  // Handle tilde expansion
  if (p.startsWith('~/')) {
    p = joinHome(p.slice(2));
  } else if (p === '~') {
    p = getHome();
  }
  // Resolve relative paths against current working directory
  if (!p.startsWith('/')) {
    p = `${getCwd()}/${p}`;
  }
  return normalize(p);
}

function joinHome(relative: string): string {
  const home = getHome();
  return relative ? `${home}/${relative}` : home;
}

function getHome(): string {
  return process.env.HOME || '/root';
}

function getCwd(): string {
  return process.cwd();
}

function normalize(p: string): string {
  // Simple normalization: resolve . and ..
  const parts = p.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      result.pop();
    } else {
      result.push(part);
    }
  }
  return result.join('/') || '/';
}

function dirname(p: string): string {
  const normalized = normalize(p);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return normalized.slice(0, lastSlash);
}

function basename(p: string): string {
  const normalized = normalize(p);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}
