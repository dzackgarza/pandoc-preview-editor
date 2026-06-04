import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import { invokeTauri, replaceEditorContents, previewText } from './editor-helpers.js';
import { parseToml } from './editor-helpers.js';

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

      const dialog = appPage.locator('[role="dialog"]');

      await appPage
        .locator('[role="menuitem"]')
        .filter({ hasText: 'File' })
        .first()
        .click();
      await appPage
        .locator('[role="menuitem"]')
        .filter({ hasText: 'Preferences' })
        .last()
        .click();
      await expect(dialog).toBeVisible();

      await dialog
        .locator('[role="tab"]')
        .filter({ hasText: 'Pandoc Configuration' })
        .click();
      const standaloneCheckbox = dialog.locator('input[aria-label="Standalone"]');
      await expect(standaloneCheckbox).toBeChecked();

      const citeprocCheckbox = dialog.locator('input[aria-label="Citeproc"]');
      await expect(citeprocCheckbox).toBeChecked();

      await citeprocCheckbox.click();
      await expect(citeprocCheckbox).not.toBeChecked();

      await dialog.locator('[role="tab"]').filter({ hasText: 'Raw Command' }).click();
      const argsTextarea = dialog.locator('textarea[aria-label="Render Command"]');
      await expect(argsTextarea).toHaveValue(/--standalone/);
      await expect(argsTextarea).not.toHaveValue(/--citeproc/);

      await dialog
        .locator('[role="tab"]')
        .filter({ hasText: 'Pandoc Configuration' })
        .click();
      await expect(standaloneCheckbox).toBeChecked();
      await expect(citeprocCheckbox).not.toBeChecked();

      await appPage.locator('button').filter({ hasText: 'Apply Settings' }).click();
      await expect(dialog).not.toBeVisible();

      const savedTomlContent = readFileSync(tomlPath, 'utf-8');
      const parsedToml = parseToml(savedTomlContent);
      expect(parsedToml.pandoc.render_command).toContain('--standalone');
      expect(parsedToml.pandoc.render_command).not.toContain('--citeproc');

      await appPage
        .locator('[role="menuitem"]')
        .filter({ hasText: 'File' })
        .first()
        .click();
      await appPage
        .locator('[role="menuitem"]')
        .filter({ hasText: 'Preferences' })
        .last()
        .click();
      await expect(dialog).toBeVisible();

      await dialog.locator('[role="tab"]').filter({ hasText: 'Raw Command' }).click();
      const escapeArgs = 'pandoc --standalone --template=/tmp/escape.html';
      await argsTextarea.fill(escapeArgs);

      await appPage.locator('button').filter({ hasText: 'Apply Settings' }).click();
      await expect(dialog).toBeVisible();
      await expect(
        dialog
          .locator('*')
          .filter({ hasText: /is external.*templates directory/i })
          .first(),
      ).toBeVisible();

      await dialog.locator('button').filter({ hasText: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
    },
  );

  settingsTest(
    'Preferences has full tab set, Lua filters, and plugins library',
    async ({ appPage, testEnv }) => {
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

      await expect(appPage.getByTestId('editor')).toBeVisible();

      await appPage
        .locator('[role="menuitem"]')
        .filter({ hasText: 'File' })
        .first()
        .click();
      await appPage
        .locator('[role="menuitem"]')
        .filter({ hasText: 'Preferences' })
        .last()
        .click();

      const dialog = appPage.locator('[role="dialog"]');
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
        await expect(
          dialog.locator('[role="tab"]').filter({ hasText: tab }),
        ).toBeVisible();
      }

      await dialog.locator('[role="tab"]').filter({ hasText: 'Lua Filters' }).click();
      await expect(dialog.locator('[aria-label="Filters Directory"]')).toHaveValue(
        filtersDir,
      );
      await expect(
        dialog.locator('*').filter({ hasText: 'my-filter.lua' }),
      ).toBeVisible();

      await dialog.locator('[role="tab"]').filter({ hasText: 'Plugins' }).click();
      await expect(
        dialog.locator('*').filter({ hasText: 'Export to PDF' }),
      ).toBeVisible();

      await dialog.locator('button').filter({ hasText: 'Cancel' }).click();
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
        templatesDir,
        filtersDir,
        debounceMs: 100,
        timeoutMs: 30000,
        renderCommand: newCommand,
        restoreLastFile: true,
      });
      expect(result).toEqual({ ok: true });

      const savedTomlContent = readFileSync(tomlPath, 'utf-8');
      const parsedToml = parseToml(savedTomlContent);
      expect(parsedToml.pandoc.render_command).toContain('--mathjax');
      expect(parsedToml.pandoc.render_command).not.toContain('--citeproc');
    },
  );
});
