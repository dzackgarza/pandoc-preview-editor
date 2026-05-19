import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { load } from 'js-toml';

export interface PreviewConfig {
  configPath: string | null;
  render: {
    debounceMs: number;
    timeoutMs: number;
  };
  pandoc: {
    command: string;
    args: string[];
  };
}

export interface CliPandocOverrides {
  bibliography?: string;
  csl?: string;
  katex?: boolean;
}

const DEFAULT_CONFIG: Omit<PreviewConfig, 'configPath'> = {
  render: {
    debounceMs: 750,
    timeoutMs: 30000,
  },
  pandoc: {
    command: 'pandoc',
    args: [
      '-f',
      'markdown+tex_math_dollars+citations',
      '-t',
      'html',
      '--standalone',
      '--citeproc',
      '--mathjax',
    ],
  },
};

export function loadPreviewConfig(
  filePath: string,
  explicitConfigPath?: string,
): PreviewConfig {
  const configPath = findConfigPath(filePath, explicitConfigPath);
  const config: PreviewConfig = {
    configPath,
    render: { ...DEFAULT_CONFIG.render },
    pandoc: {
      command: DEFAULT_CONFIG.pandoc.command,
      args: [...DEFAULT_CONFIG.pandoc.args],
    },
  };

  if (!configPath) return config;

  const parsed = load(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  const render = readTable(parsed.render, 'render');
  const pandoc = readTable(parsed.pandoc, 'pandoc');

  if (render.debounce_ms !== undefined) {
    config.render.debounceMs = readPositiveInteger(
      render.debounce_ms,
      'render.debounce_ms',
    );
  }
  if (render.timeout_ms !== undefined) {
    config.render.timeoutMs = readPositiveInteger(render.timeout_ms, 'render.timeout_ms');
  }
  if (pandoc.command !== undefined) {
    config.pandoc.command = readString(pandoc.command, 'pandoc.command');
  }
  if (pandoc.args !== undefined) {
    config.pandoc.args = readStringArray(pandoc.args, 'pandoc.args');
  }

  return config;
}

export function applyCliPandocOverrides(
  config: PreviewConfig,
  overrides: CliPandocOverrides,
): PreviewConfig {
  const next: PreviewConfig = {
    configPath: config.configPath,
    render: { ...config.render },
    pandoc: {
      command: config.pandoc.command,
      args: [...config.pandoc.args],
    },
  };

  if (overrides.katex) {
    next.pandoc.args = next.pandoc.args.filter(
      (arg) => arg !== '--mathjax' && arg !== '--katex',
    );
    next.pandoc.args.push('--katex');
  }
  if (overrides.bibliography) {
    next.pandoc.args.push('--bibliography', overrides.bibliography);
  }
  if (overrides.csl) {
    next.pandoc.args.push('--csl', overrides.csl);
  }

  return next;
}

function findConfigPath(filePath: string, explicitConfigPath?: string): string | null {
  if (explicitConfigPath) return resolve(explicitConfigPath);

  const absFilePath = resolve(filePath);
  const candidates = [
    join(dirname(absFilePath), 'pandoc-preview.toml'),
    join(process.cwd(), 'pandoc-preview.toml'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function readTable(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be a TOML table`);
  }
  return value as Record<string, unknown>;
}

function readPositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
  return value as number;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function readStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${path} must be an array of strings`);
  }
  return value as string[];
}
