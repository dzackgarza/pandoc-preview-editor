import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import { load } from 'js-toml';

async function invokeConfig(
  appPage: any,
  method: string,
  args: Record<string, unknown>,
) {
  return appPage.evaluate(
    async ({ cmd, params }: { cmd: string; params: Record<string, unknown> }) => {
      return (window as any).__TAURI_INTERNALS__.invoke(cmd, params);
    },
    { cmd: method, params: args },
  );
}

const commandParsingTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
    const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

    if (!existsSync(templatesDir)) mkdirSync(templatesDir, { recursive: true });
    if (!existsSync(filtersDir)) mkdirSync(filtersDir, { recursive: true });

    writeFileSync(
      path.join(templatesDir, 'custom.html'),
      '<html>$body$</html>',
      'utf-8',
    );
    writeFileSync(path.join(filtersDir, 'my-filter.lua'), '-- Lua filter', 'utf-8');
    writeFileSync(path.join(filtersDir, 'another.lua'), '-- Another filter', 'utf-8');

    const docPath = path.join(testEnv.workspaceDir, 'doc.md');
    writeFileSync(docPath, '# Document\n', 'utf-8');

    testEnv.writeConfig({
      renderCommand: 'pandoc -f markdown -t html --standalone --citeproc --mathjax',
      templatesDir,
      filtersDir,
    });

    testEnv.writeSessionState(docPath, false);

    await use(testEnv);
  },
});

test.describe('Command parsing via Tauri IPC', () => {
  commandParsingTest(
    'pandoc_assets returns all filters in the configured directory',
    async ({ appPage, testEnv }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const assets = await invokeConfig(appPage, 'pandoc_assets', {});
      const filters = (assets as any).filters as string[];

      expect(filters).toContain('my-filter.lua');
      expect(filters).toContain('another.lua');
    },
  );

  commandParsingTest(
    'get_config returns parsed flags from the render command',
    async ({ appPage, testEnv }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const config = await invokeConfig(appPage, 'get_config', {});
      const c = config as Record<string, unknown>;
      const parsedFlags = c.parsedFlags as Record<string, unknown>;

      expect(parsedFlags.standalone).toBe(true);
      expect(parsedFlags.citeproc).toBe(true);
      expect(parsedFlags.math_engine).toBe('MathJax');
      expect(Array.isArray(parsedFlags.filters)).toBe(true);
    },
  );

  commandParsingTest(
    'set_config updates parsed flags and persists to TOML',
    async ({ appPage, testEnv }) => {
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const result = await invokeConfig(appPage, 'set_config', {
        templates_dir: templatesDir,
        filters_dir: filtersDir,
        debounce_ms: 100,
        timeout_ms: 30000,
        render_command: 'pandoc --standalone -t html5',
        restore_last_file: true,
      });
      expect(result).toEqual({ ok: true });

      const config = await invokeConfig(appPage, 'get_config', {});
      const c = config as Record<string, unknown>;
      const parsedFlags = c.parsedFlags as Record<string, unknown>;

      expect(parsedFlags.standalone).toBe(true);
      expect(parsedFlags.citeproc).toBe(false);
      expect(parsedFlags.math_engine).toBe('None');
      expect(c.renderCommand).toContain('--standalone');
      expect(c.renderCommand).not.toContain('--citeproc');

      const tomlContent = readFileSync(testEnv.configPath, 'utf-8');
      const parsedToml = load(tomlContent) as any;
      expect(parsedToml.pandoc.render_command).toContain('--standalone');
      expect(parsedToml.pandoc.render_command).not.toContain('--citeproc');
    },
  );

  commandParsingTest(
    'set_config with lua-filter updates parsed flags',
    async ({ appPage, testEnv }) => {
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');
      const filterPath = path.join(filtersDir, 'my-filter.lua');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const result = await invokeConfig(appPage, 'set_config', {
        templates_dir: templatesDir,
        filters_dir: filtersDir,
        debounce_ms: 100,
        timeout_ms: 30000,
        render_command: `pandoc --standalone --lua-filter=${filterPath}`,
        restore_last_file: true,
      });
      expect(result).toEqual({ ok: true });

      const config = await invokeConfig(appPage, 'get_config', {});
      const c = config as Record<string, unknown>;
      const parsedFlags = c.parsedFlags as Record<string, unknown>;

      expect(Array.isArray(parsedFlags.filters)).toBe(true);
      const filters = parsedFlags.filters as Array<Record<string, string>>;
      const myFilter = filters.find((f) => f.path === filterPath);
      expect(myFilter).toBeDefined();
      expect(myFilter!.flag).toBe('lua-filter');
    },
  );

  commandParsingTest(
    'set_config with --filter flag updates parsed flags',
    async ({ appPage, testEnv }) => {
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');
      const filterPath = path.join(filtersDir, 'my-filter.lua');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const result = await invokeConfig(appPage, 'set_config', {
        templates_dir: templatesDir,
        filters_dir: filtersDir,
        debounce_ms: 100,
        timeout_ms: 30000,
        render_command: `pandoc --standalone --filter ${filterPath}`,
        restore_last_file: true,
      });
      expect(result).toEqual({ ok: true });

      const config = await invokeConfig(appPage, 'get_config', {});
      const c = config as Record<string, unknown>;
      const parsedFlags = c.parsedFlags as Record<string, unknown>;

      const filters = parsedFlags.filters as Array<Record<string, string>>;
      const myFilter = filters.find((f) => f.path === filterPath);
      expect(myFilter).toBeDefined();
      expect(myFilter!.flag).toBe('filter');
    },
  );

  commandParsingTest(
    'command with --template flag updates parsed flags',
    async ({ appPage, testEnv }) => {
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');
      const templatePath = path.join(templatesDir, 'custom.html');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const result = await invokeConfig(appPage, 'set_config', {
        templates_dir: templatesDir,
        filters_dir: filtersDir,
        debounce_ms: 100,
        timeout_ms: 30000,
        render_command: `pandoc --standalone --template=${templatePath}`,
        restore_last_file: true,
      });
      expect(result).toEqual({ ok: true });

      const config = await invokeConfig(appPage, 'get_config', {});
      const c = config as Record<string, unknown>;
      const parsedFlags = c.parsedFlags as Record<string, unknown>;

      expect(parsedFlags.template).toBe(templatePath);
    },
  );
});

test.describe('Command parsing via Settings dialog', () => {
  commandParsingTest(
    'toggling citeproc updates raw command and persists',
    async ({ appPage, testEnv }) => {
      const tomlPath = testEnv.configPath;

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect.poll(() => previewText(appPage)).toContain('Document');

      const dialog = appPage.getByRole('dialog');

      await appPage.getByRole('menuitem', { name: 'File' }).click();
      await appPage.getByRole('menuitem', { name: 'Preferences...' }).click();
      await expect(dialog).toBeVisible();

      await dialog.getByRole('tab', { name: 'Pandoc Configuration' }).click();
      const standaloneCheckbox = dialog.locator('input[aria-label="Standalone"]');
      await expect(standaloneCheckbox).toBeChecked();

      const citeprocCheckbox = dialog.locator('input[aria-label="Citeproc"]');
      await expect(citeprocCheckbox).toBeChecked();

      await citeprocCheckbox.click();
      await expect(citeprocCheckbox).not.toBeChecked();

      await dialog.getByRole('tab', { name: 'Raw Command' }).click();
      const argsTextarea = dialog.locator('textarea[aria-label="Render Command"]');
      await expect(argsTextarea).toHaveValue(/--standalone/);
      await expect(argsTextarea).not.toHaveValue(/--citeproc/);

      await dialog.getByRole('tab', { name: 'Pandoc Configuration' }).click();
      await expect(standaloneCheckbox).toBeChecked();
      await expect(citeprocCheckbox).not.toBeChecked();

      await appPage.getByRole('button', { name: 'Apply Settings' }).click();
      await expect(dialog).not.toBeVisible();

      const savedTomlContent = readFileSync(tomlPath, 'utf-8');
      const parsedToml = load(savedTomlContent) as any;
      expect(parsedToml.pandoc.render_command).toContain('--standalone');
      expect(parsedToml.pandoc.render_command).not.toContain('--citeproc');
    },
  );

  commandParsingTest(
    'toggling a lua filter updates raw command and persists',
    async ({ appPage, testEnv }) => {
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect.poll(() => previewText(appPage)).toContain('Document');

      const dialog = appPage.getByRole('dialog');

      await appPage.getByRole('menuitem', { name: 'File' }).click();
      await appPage.getByRole('menuitem', { name: 'Preferences...' }).click();
      await expect(dialog).toBeVisible();

      await dialog.getByRole('tab', { name: 'Lua Filters' }).click();
      await expect(dialog.getByLabel('Filters Directory')).toHaveValue(filtersDir);

      const myFilterCheckbox = dialog.locator('input[type="checkbox"]').filter({
        hasText: 'my-filter.lua',
      });
      await myFilterCheckbox.click();
      await expect(myFilterCheckbox).toBeChecked();

      await dialog.getByRole('tab', { name: 'Raw Command' }).click();
      const argsTextarea = dialog.locator('textarea[aria-label="Render Command"]');
      await expect(argsTextarea).toHaveValue(/my-filter\.lua/);

      await appPage.getByRole('button', { name: 'Apply Settings' }).click();
      await expect(dialog).not.toBeVisible();

      const savedTomlContent = readFileSync(testEnv.configPath, 'utf-8');
      const parsedToml = load(savedTomlContent) as any;
      expect(parsedToml.pandoc.render_command).toContain('my-filter.lua');
    },
  );

  commandParsingTest(
    'disabling all filters preserves non-filter flags',
    async ({ appPage, testEnv }) => {
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      await invokeConfig(appPage, 'set_config', {
        templates_dir: templatesDir,
        filters_dir: filtersDir,
        debounce_ms: 100,
        timeout_ms: 30000,
        render_command:
          'pandoc --standalone --citeproc --mathjax --lua-filter=' +
          path.join(filtersDir, 'my-filter.lua'),
        restore_last_file: true,
      });

      const dialog = appPage.getByRole('dialog');

      await appPage.getByRole('menuitem', { name: 'File' }).click();
      await appPage.getByRole('menuitem', { name: 'Preferences...' }).click();
      await expect(dialog).toBeVisible();

      await dialog.getByRole('tab', { name: 'Lua Filters' }).click();
      const myFilterCheckbox = dialog.locator('input[type="checkbox"]').filter({
        hasText: 'my-filter.lua',
      });
      await expect(myFilterCheckbox).toBeChecked();

      await myFilterCheckbox.click();
      await expect(myFilterCheckbox).not.toBeChecked();

      await dialog.getByRole('tab', { name: 'Raw Command' }).click();
      const argsTextarea = dialog.locator('textarea[aria-label="Render Command"]');
      await expect(argsTextarea).toHaveValue(/--standalone/);
      await expect(argsTextarea).toHaveValue(/--citeproc/);
      await expect(argsTextarea).not.toHaveValue(/my-filter\.lua/);

      await appPage.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
    },
  );
});

async function previewText(appPage: any) {
  return appPage.locator('#preview').evaluate((element: HTMLIFrameElement) => {
    return element.contentDocument?.body?.textContent ?? '';
  });
}