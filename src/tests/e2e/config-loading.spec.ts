import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import { invokeTauri } from './editor-helpers.js';
import { parseToml } from './editor-helpers.js';

const defaultConfigTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    testEnv.writeConfig();
    await use(testEnv);
  },
});

const customConfigTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const markdownPath = path.join(testEnv.workspaceDir, 'notes', 'doc.md');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(path.join(testEnv.workspaceDir, 'notes'), { recursive: true });
    writeFileSync(
      markdownPath,
      '# Test Document\n\nLoaded with custom config.\n',
      'utf-8',
    );

    testEnv.writeConfig({
      debounceMs: 999,
      timeoutMs: 40000,
      renderCommand: 'pandoc -f markdown -t html --standalone',
    });

    testEnv.writeSessionState(markdownPath, false);

    await use(testEnv);
  },
});

const missingConfigTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const { rmSync, writeFileSync, mkdirSync } = await import('node:fs');
    if (existsSync(testEnv.configPath)) {
      rmSync(testEnv.configPath, { force: true });
    }

    mkdirSync(testEnv.workspaceDir, { recursive: true });
    const markdownPath = path.join(testEnv.workspaceDir, 'orphan.md');
    writeFileSync(markdownPath, '# No Config File\n\nShould still launch.\n', 'utf-8');

    await use(testEnv);
  },
});

test.describe('Centralized TOML Configuration (Tauri)', () => {
  defaultConfigTest(
    'initializes config.toml in XDG directory when no config exists',
    async ({ appPage, testEnv }) => {
      const configDir = path.join(testEnv.xdgConfigHome, 'pandoc-preview');

      expect(existsSync(testEnv.configPath)).toBe(true);

      const contents = readFileSync(testEnv.configPath, 'utf-8');
      expect(contents).toContain('[render]');
      expect(contents).toContain('[pandoc]');
    },
  );

  defaultConfigTest(
    'config.toml values are reflected in get_config invoke',
    async ({ appPage, testEnv }) => {
      const config = await invokeTauri(appPage, 'get_config', {});

      expect(typeof config).toBe('object');
      expect(config).not.toBeNull();

      const c = config as Record<string, unknown>;
      expect(typeof c.debounceMs).toBe('number');
      expect(c.debounceMs).toBe(50);
      expect(typeof c.renderCommand).toBe('string');
      expect(c.renderCommand).toContain('pandoc');
      expect(typeof c.templatesDir).toBe('string');
      expect(typeof c.filtersDir).toBe('string');
    },
  );

  customConfigTest(
    'loads existing config.toml from XDG directory with custom values',
    async ({ appPage, testEnv }) => {
      const configDir = path.join(testEnv.xdgConfigHome, 'pandoc-preview');

      expect(existsSync(testEnv.configPath)).toBe(true);

      const contents = readFileSync(testEnv.configPath, 'utf-8');
      expect(contents).toContain('debounce_ms = 999');
      expect(contents).toContain('timeout_ms = 40000');

      const config = await invokeTauri(appPage, 'get_config', {});
      const c = config as Record<string, unknown>;

      expect(c.debounceMs).toBe(999);
      expect(c.timeoutMs).toBe(40000);
      expect(c.renderCommand).toContain('--standalone');
    },
  );

  customConfigTest(
    'custom config is not overwritten on app startup',
    async ({ appPage, testEnv }) => {
      const beforeStart = readFileSync(testEnv.configPath, 'utf-8');

      const config = await invokeTauri(appPage, 'get_config', {});
      const c = config as Record<string, unknown>;
      expect(c.debounceMs).toBe(999);

      const afterStart = readFileSync(testEnv.configPath, 'utf-8');
      expect(afterStart).toContain('debounce_ms = 999');
      expect(afterStart).toContain('timeout_ms = 40000');
    },
  );

  customConfigTest(
    'set_config writes updated TOML to disk and updates runtime state',
    async ({ appPage, testEnv }) => {
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

      const result = await invokeTauri(appPage, 'set_config', {
        templates_dir: templatesDir,
        filters_dir: filtersDir,
        debounce_ms: 200,
        timeout_ms: 15000,
        render_command: 'pandoc -f markdown -t html5 --mathjax',
        restore_last_file: true,
      });
      expect(result).toEqual({ ok: true });

      const savedContent = readFileSync(testEnv.configPath, 'utf-8');
      const parsedToml = parseToml(savedContent);
      expect(parsedToml.render.debounce_ms).toBe(200);
      expect(parsedToml.render.timeout_ms).toBe(15000);
      expect(parsedToml.pandoc.render_command).toContain('--mathjax');

      const config = await invokeTauri(appPage, 'get_config', {});
      const c = config as Record<string, unknown>;
      expect(c.debounceMs).toBe(200);
      expect(c.renderCommand).toContain('--mathjax');
    },
  );
});
