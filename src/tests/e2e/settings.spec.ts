import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import { invokeTauri, replaceEditorContents, previewText } from './editor-helpers.js';
import { load } from 'js-toml';

const settingsTest = test.extend({
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

test.describe('Settings and Preferences (Tauri)', () => {
  settingsTest(
    'Settings dialog supports bidirectional sync, persists to TOML, and validates paths',
    async ({ appPage, testEnv }) => {
      const tomlPath = testEnv.configPath;
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

      await expect(appPage.getByTestId('editor')).toBeVisible();
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

      await appPage.getByRole('menuitem', { name: 'File' }).click();
      await appPage.getByRole('menuitem', { name: 'Preferences...' }).click();
      await expect(dialog).toBeVisible();

      await dialog.getByRole('tab', { name: 'Raw Command' }).click();
      const escapeArgs = 'pandoc --standalone --template=/tmp/escape.html';
      await argsTextarea.fill(escapeArgs);

      await appPage.getByRole('button', { name: 'Apply Settings' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/is external.*templates directory/i)).toBeVisible();

      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
    },
  );

  settingsTest(
    'Preferences has full tab set, Lua filters, and plugins library',
    async ({ appPage, testEnv }) => {
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

      await expect(appPage.getByTestId('editor')).toBeVisible();

      await appPage.getByRole('menuitem', { name: 'File' }).click();
      await appPage.getByRole('menuitem', { name: 'Preferences...' }).click();

      const dialog = appPage.getByRole('dialog');
      await expect(dialog).toBeVisible();

      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(800);
        expect(box.height).toBeGreaterThanOrEqual(500);
      }

      const tabs = [
        'General',
        'Pandoc Configuration',
        'Lua Filters',
        'Asset Resolution',
        'Plugins',
      ];
      for (const tab of tabs) {
        await expect(dialog.getByRole('tab', { name: tab })).toBeVisible();
      }

      await dialog.getByRole('tab', { name: 'Lua Filters' }).click();
      await expect(dialog.getByLabel('Filters Directory')).toHaveValue(filtersDir);
      await expect(dialog.getByText('my-filter.lua', { exact: true })).toBeVisible();

      await dialog.getByRole('tab', { name: 'Plugins' }).click();
      await expect(dialog.getByText('Export to PDF')).toBeVisible();

      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
    },
  );

  settingsTest(
    'set_config via invoke writes TOML and updates runtime state',
    async ({ appPage, testEnv }) => {
      const tomlPath = testEnv.configPath;
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

      await expect(appPage.getByTestId('editor')).toBeVisible();

      const newCommand = 'pandoc -f markdown -t html --standalone --mathjax';
      const result = await invokeTauri(appPage, 'set_config', {
        templates_dir: templatesDir,
        filters_dir: filtersDir,
        debounce_ms: 100,
        timeout_ms: 30000,
        render_command: newCommand,
        restore_last_file: true,
      });
      expect(result).toEqual({ ok: true });

      const savedTomlContent = readFileSync(tomlPath, 'utf-8');
      const parsedToml = load(savedTomlContent) as any;
      expect(parsedToml.pandoc.render_command).toContain('--mathjax');
      expect(parsedToml.pandoc.render_command).not.toContain('--citeproc');
    },
  );
});
