import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killServer, launchServer, type ServerInstance } from './helpers.js';
import { load } from 'js-toml';

function createConfig(renderCommand: string) {
  const dir = join(
    tmpdir(),
    `pandoc-parsing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  const tomlPath = join(dir, 'pandoc-preview.toml');
  const filtersDir = join(dir, 'filters');
  const templatesDir = join(dir, 'templates');
  mkdirSync(filtersDir, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });

  writeFileSync(join(filtersDir, 'my-filter.lua'), '-- filter', 'utf-8');
  writeFileSync(join(filtersDir, 'another.lua'), '-- filter', 'utf-8');
  writeFileSync(join(templatesDir, 'custom.html'), '<html>$body$</html>', 'utf-8');

  const toml = [
    '[render]',
    'debounce_ms = 750',
    'timeout_ms = 30000',
    '',
    '[pandoc]',
    `render_command = ${JSON.stringify(renderCommand)}`,
    `templates_dir = ${JSON.stringify(templatesDir)}`,
    `filters_dir = ${JSON.stringify(filtersDir)}`,
  ].join('\n');
  writeFileSync(tomlPath, toml, 'utf-8');
  return { dir, tomlPath, filtersDir, templatesDir };
}

function cleanup(dir: string) {
  try {
    const { rmSync } = require('node:fs');
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

// ── GET /api/filters parsing ────────────────────────────────────────────

test.describe('Command parsing: GET /api/filters', () => {
  test('command with no flags returns empty enabled set', async () => {
    const { dir, tomlPath } = createConfig('pandoc');
    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, undefined, tomlPath);
      const res = await fetch(`${server.url}/api/filters`);
      const data = (await res.json()) as {
        filters: Array<{ name: string; enabled: boolean }>;
      };
      expect(data.filters.every((f) => !f.enabled)).toBe(true);
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('command with --lua-filter=<absolute-path> enables the filter', async () => {
    const { dir, tomlPath, filtersDir } = createConfig('pandoc --standalone');
    const filterAbsPath = join(filtersDir, 'my-filter.lua');
    const server = await launchServer(undefined, undefined, tomlPath);
    try {
      // Reconfigure the server's command to include the filter
      const cfgRes = await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir: join(dir, 'templates'),
          filtersDir,
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: `pandoc --standalone --lua-filter=${filterAbsPath}`,
        }),
      });
      expect(cfgRes.ok).toBe(true);

      const res = await fetch(`${server.url}/api/filters`);
      const data = (await res.json()) as {
        filters: Array<{ name: string; enabled: boolean }>;
      };
      const myFilter = data.filters.find((f) => f.name === 'my-filter.lua');
      expect(myFilter).toBeDefined();
      expect(myFilter!.enabled).toBe(true);
    } finally {
      await killServer(server);
      cleanup(dir);
    }
  });

  test('command with --lua-filter <space-separated-path> enables the filter', async () => {
    const { dir, tomlPath, filtersDir } = createConfig('pandoc --standalone');
    const filterAbsPath = join(filtersDir, 'my-filter.lua');
    const server = await launchServer(undefined, undefined, tomlPath);
    try {
      const cfgRes = await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir: join(dir, 'templates'),
          filtersDir,
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: `pandoc --standalone --lua-filter ${filterAbsPath}`,
        }),
      });
      expect(cfgRes.ok).toBe(true);

      const res = await fetch(`${server.url}/api/filters`);
      const data = (await res.json()) as {
        filters: Array<{ name: string; enabled: boolean }>;
      };
      const myFilter = data.filters.find((f) => f.name === 'my-filter.lua');
      expect(myFilter).toBeDefined();
      expect(myFilter!.enabled).toBe(true);
    } finally {
      await killServer(server);
      cleanup(dir);
    }
  });

  test('command with --filter=<absolute-path> enables the filter', async () => {
    const { dir, tomlPath, filtersDir } = createConfig('pandoc --standalone');
    const filterAbsPath = join(filtersDir, 'my-filter.lua');
    const server = await launchServer(undefined, undefined, tomlPath);
    try {
      const cfgRes = await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir: join(dir, 'templates'),
          filtersDir,
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: `pandoc --standalone --filter=${filterAbsPath}`,
        }),
      });
      expect(cfgRes.ok).toBe(true);

      const res = await fetch(`${server.url}/api/filters`);
      const data = (await res.json()) as {
        filters: Array<{ name: string; enabled: boolean }>;
      };
      const myFilter = data.filters.find((f) => f.name === 'my-filter.lua');
      expect(myFilter).toBeDefined();
      expect(myFilter!.enabled).toBe(true);
    } finally {
      await killServer(server);
      cleanup(dir);
    }
  });

  test('command with --filter <space-separated-path> enables the filter', async () => {
    const { dir, tomlPath, filtersDir } = createConfig('pandoc --standalone');
    const filterAbsPath = join(filtersDir, 'my-filter.lua');
    const server = await launchServer(undefined, undefined, tomlPath);
    try {
      const cfgRes = await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir: join(dir, 'templates'),
          filtersDir,
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: `pandoc --standalone --filter ${filterAbsPath}`,
        }),
      });
      expect(cfgRes.ok).toBe(true);

      const res = await fetch(`${server.url}/api/filters`);
      const data = (await res.json()) as {
        filters: Array<{ name: string; enabled: boolean }>;
      };
      const myFilter = data.filters.find((f) => f.name === 'my-filter.lua');
      expect(myFilter).toBeDefined();
      expect(myFilter!.enabled).toBe(true);
    } finally {
      await killServer(server);
      cleanup(dir);
    }
  });

  test('multiple filters: only specified ones are enabled', async () => {
    const { dir, tomlPath, filtersDir } = createConfig('pandoc --standalone');
    const myFilterPath = join(filtersDir, 'my-filter.lua');
    const server = await launchServer(undefined, undefined, tomlPath);
    try {
      const cfgRes = await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir: join(dir, 'templates'),
          filtersDir,
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: `pandoc --standalone --lua-filter=${myFilterPath}`,
        }),
      });
      expect(cfgRes.ok).toBe(true);

      const res = await fetch(`${server.url}/api/filters`);
      const data = (await res.json()) as {
        filters: Array<{ name: string; enabled: boolean }>;
      };
      const myFilter = data.filters.find((f) => f.name === 'my-filter.lua');
      const another = data.filters.find((f) => f.name === 'another.lua');
      expect(myFilter!.enabled).toBe(true);
      expect(another!.enabled).toBe(false);
    } finally {
      await killServer(server);
      cleanup(dir);
    }
  });
});

// ── POST /api/filters parsing ───────────────────────────────────────────

test.describe('Command parsing: POST /api/filters', () => {
  test('enabling a filter adds --lua-filter to renderCommand', async () => {
    const { dir, tomlPath } = createConfig('pandoc --standalone');
    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, undefined, tomlPath);
      const res = await fetch(`${server.url}/api/filters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: ['my-filter.lua'] }),
      });
      const data = (await res.json()) as { ok: boolean; renderCommand: string };
      expect(data.ok).toBe(true);
      // shell-quote escapes '=' when serializing, so --lua-filter= becomes --lua-filter\=
      expect(data.renderCommand).toContain('my-filter.lua');
      expect(data.renderCommand).toContain('--standalone');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('disabling all filters removes all --lua-filter and --filter flags', async () => {
    const { dir, tomlPath, filtersDir } = createConfig('pandoc --standalone');
    // First enable a filter, then disable it
    const server = await launchServer(undefined, undefined, tomlPath);
    try {
      await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir: join(dir, 'templates'),
          filtersDir,
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: `pandoc --standalone --lua-filter=${join(filtersDir, 'my-filter.lua')}`,
        }),
      });

      const res = await fetch(`${server.url}/api/filters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: [] }),
      });
      const data = (await res.json()) as { ok: boolean; renderCommand: string };
      expect(data.ok).toBe(true);
      expect(data.renderCommand).not.toContain('--lua-filter');
      expect(data.renderCommand).toContain('--standalone');
    } finally {
      await killServer(server);
      cleanup(dir);
    }
  });

  test('toggling filters preserves non-filter flags', async () => {
    const { dir, tomlPath, filtersDir } = createConfig('pandoc --standalone');
    const myFilterPath = join(filtersDir, 'my-filter.lua');
    const server = await launchServer(undefined, undefined, tomlPath);
    try {
      await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir: join(dir, 'templates'),
          filtersDir,
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: `pandoc --standalone --citeproc --lua-filter=${myFilterPath}`,
        }),
      });

      const res = await fetch(`${server.url}/api/filters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: ['another.lua'] }),
      });
      const data = (await res.json()) as { ok: boolean; renderCommand: string };
      expect(data.ok).toBe(true);
      expect(data.renderCommand).toContain('--standalone');
      expect(data.renderCommand).toContain('--citeproc');
      expect(data.renderCommand).toContain('another.lua');
      expect(data.renderCommand).not.toContain('my-filter.lua');
    } finally {
      await killServer(server);
      cleanup(dir);
    }
  });

  test('toggling filters persists to TOML file', async () => {
    const { dir, tomlPath } = createConfig('pandoc --standalone');
    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, undefined, tomlPath);
      await fetch(`${server.url}/api/filters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: ['my-filter.lua'] }),
      });
      const tomlContent = readFileSync(tomlPath, 'utf-8');
      const parsed = load(tomlContent) as any;
      expect(parsed.pandoc.render_command).toContain('my-filter.lua');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });
});

// ── POST /api/config path validation ────────────────────────────────────

test.describe('Command parsing: POST /api/config validation', () => {
  test('rejects template path outside templates directory', async () => {
    const { dir, tomlPath, templatesDir } = createConfig('pandoc --standalone');
    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, undefined, tomlPath);
      const res = await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir,
          filtersDir: join(dir, 'filters'),
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: 'pandoc --standalone --template=/tmp/escape.html',
        }),
      });
      const data = (await res.json()) as { error?: string };
      expect(res.ok).toBe(false);
      expect(data.error).toContain('external');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('rejects filter path outside filters directory', async () => {
    const { dir, tomlPath, templatesDir, filtersDir } = createConfig('pandoc');
    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, undefined, tomlPath);
      const res = await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir,
          filtersDir,
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: 'pandoc --lua-filter=/tmp/escape.lua',
        }),
      });
      const data = (await res.json()) as { error?: string };
      expect(res.ok).toBe(false);
      expect(data.error).toContain('external');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('accepts template path inside templates directory', async () => {
    const { dir, tomlPath, templatesDir } = createConfig('pandoc --standalone');
    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, undefined, tomlPath);
      const res = await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir,
          filtersDir: join(dir, 'filters'),
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: `pandoc --standalone --template=${join(templatesDir, 'custom.html')}`,
        }),
      });
      expect(res.ok).toBe(true);
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('accepts filter path inside filters directory', async () => {
    const { dir, tomlPath, templatesDir, filtersDir } = createConfig('pandoc');
    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, undefined, tomlPath);
      const res = await fetch(`${server.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir,
          filtersDir,
          debounceMs: 750,
          timeoutMs: 30000,
          renderCommand: `pandoc --lua-filter=${join(filtersDir, 'my-filter.lua')}`,
        }),
      });
      expect(res.ok).toBe(true);
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });
});
