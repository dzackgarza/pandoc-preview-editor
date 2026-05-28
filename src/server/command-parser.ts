import path from 'node:path';
import os from 'node:os';
import {
  tokenize,
  ParsedFlags,
  parseCommand,
  buildCommand,
} from '../shared/command-parser.js';

export {
  tokenize,
  ParsedFlags,
  parseCommand,
  buildCommand,
} from '../shared/command-parser.js';

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
      if (path.dirname(resolved) === absFiltersDir) {
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
      if (path.dirname(resolved) !== absTemplatesDir) {
        return {
          valid: false,
          error: `Template file '${path.basename(templatePath)}' is external. Please place it in the templates directory first so the app can discover it.`,
        };
      }
    }

    if (filterPath) {
      const resolved = resolvePath(filterPath);
      if (path.dirname(resolved) !== absFiltersDir) {
        return {
          valid: false,
          error: `Filter file '${path.basename(filterPath)}' is external. Please place it in the filters directory first so the app can discover it.`,
        };
      }
    }
  }

  return { valid: true };
}

// ── Internal path helpers using native node:path and node:os ──────────

function getHome(): string {
  return os.homedir() || process.env.HOME || '/root';
}

function resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    p = path.join(getHome(), p.slice(2));
  } else if (p === '~') {
    p = getHome();
  }
  return path.resolve(p);
}

