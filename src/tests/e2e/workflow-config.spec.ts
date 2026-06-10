import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  PANDOC_FILTER_FILES,
  PANDOC_TEMPLATE_CONTENT,
  PANDOC_TEMPLATE_NAME,
  test,
} from './fixtures.js';
import {
  invokeTauri,
  parseToml,
  previewText,
  replaceEditorContents,
} from './editor-helpers.js';

const configWorkflowTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
    const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');

    mkdirSync(templatesDir, { recursive: true });
    mkdirSync(filtersDir, { recursive: true });

    writeFileSync(path.join(templatesDir, 'custom.html'), '<html>$body$</html>', 'utf-8');
    writeFileSync(path.join(filtersDir, 'my-filter.lua'), '-- Lua filter', 'utf-8');
    writeFileSync(path.join(filtersDir, 'another.lua'), '-- Another filter', 'utf-8');

    const docPath = path.join(testEnv.workspaceDir, 'doc.md');
    writeFileSync(docPath, '# Document\n', 'utf-8');

    testEnv.writeSessionState(docPath, false);
    await use(testEnv);
  },
});

test.describe('Desktop Configuration Workflow (Consolidated)', () => {
  configWorkflowTest(
    'exercises config lifecycle: creation, UI preferences, raw command parsing, and persistence',
    async ({ appPage, testEnv }) => {
      const tomlPath = testEnv.configPath;
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');
      const filterPath = path.join(filtersDir, 'my-filter.lua');
      const templatePath = path.join(testEnv.templatesDir, PANDOC_TEMPLATE_NAME);

      // 1. Creation Proof (Missing Config)
      const initialToml = parseToml(readFileSync(tomlPath, 'utf-8'));
      expect(initialToml.pandoc.render_command).toContain('--standalone');
      expect(initialToml.pandoc.render_command).toContain(`--template=${templatePath}`);
      expect(initialToml.pandoc.templates_dir).toBe(testEnv.templatesDir);
      expect(initialToml.pandoc.filters_dir).toBe(testEnv.filtersDir);
      expect(initialToml.pandoc.figures_dir).toBe(testEnv.figuresDir);
      expect(readFileSync(templatePath, 'utf-8')).toBe(PANDOC_TEMPLATE_CONTENT);
      for (const { name, content } of PANDOC_FILTER_FILES) {
        expect(readFileSync(path.join(testEnv.filtersDir, name), 'utf-8')).toBe(content);
        expect(initialToml.pandoc.render_command).toContain(
          `--lua-filter=${path.join(testEnv.filtersDir, name)}`,
        );
      }

      // 2. Settings UI Interaction
      await appPage.getByTestId('menu-trigger-file').click();
      await appPage.getByTestId('menu-item-preferences').click();
      const dialog = appPage.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();

      await dialog.locator('[role="tab"]').filter({ hasText: 'Pandoc Configuration' }).click();
      const citeprocCheckbox = dialog.locator('input[aria-label="Citeproc"]');
      await expect(citeprocCheckbox).toBeChecked();
      await citeprocCheckbox.click(); // Toggle off
      await expect(citeprocCheckbox).not.toBeChecked();

      // 3. Raw Command Sync
      await dialog.locator('[role="tab"]').filter({ hasText: 'Raw Command' }).click();
      const argsTextarea = dialog.locator('textarea[aria-label="Render Command"]');
      await expect(argsTextarea).not.toHaveValue(/--citeproc/);
      await expect(argsTextarea).toHaveValue(/--standalone/);

      // 4. Persistence to Disk and Runtime
      await appPage.locator('button').filter({ hasText: 'Apply Settings' }).click();
      await expect(dialog).not.toBeVisible();

      const savedToml = parseToml(readFileSync(tomlPath, 'utf-8'));
      expect(savedToml.pandoc.render_command).not.toContain('--citeproc');

      // Verify runtime update via UI
      await appPage.getByTestId('menu-trigger-file').click();
      await appPage.getByTestId('menu-item-preferences').click();
      await expect(dialog).toBeVisible();
      await dialog.locator('[role="tab"]').filter({ hasText: 'Pandoc Configuration' }).click();
      const runtimeConfig = await invokeTauri<
        import('../../client/components/SettingsDialog.js').SettingsData
      >(appPage, 'get_config', {});
      expect(runtimeConfig.renderCommand).not.toContain('--citeproc');

      // 5. Complex Command Parsing (via UI)
      await dialog.locator('[role="tab"]').filter({ hasText: 'Raw Command' }).click();
      const complexCommand = `pandoc --standalone --lua-filter=${filterPath} -t html5`;
      await argsTextarea.fill(complexCommand);
      await appPage.locator('button').filter({ hasText: 'Apply Settings' }).click();
      await expect(dialog).not.toBeVisible();

      // Verify parsing result in UI
      await appPage.getByTestId('menu-trigger-file').click();
      await appPage.getByTestId('menu-item-preferences').click();
      await expect(dialog).toBeVisible();
      await dialog.locator('[role="tab"]').filter({ hasText: 'Lua Filters' }).click();

      const filterCheckbox = dialog.locator('input[type="checkbox"]').filter({ hasText: 'my-filter.lua' });
      await expect(filterCheckbox).toBeVisible();
      await expect(filterCheckbox).toBeChecked();

      // 6. Path Validation (Rejection of external paths)
      await dialog.locator('[role="tab"]').filter({ hasText: 'Raw Command' }).click();
      const externalTemplate = path.join(testEnv.rootDir, 'external.html');
      writeFileSync(externalTemplate, '<html>$body$</html>', 'utf-8');
      await argsTextarea.fill(`pandoc --template=${externalTemplate}`);
      await appPage.locator('button').filter({ hasText: 'Apply Settings' }).click();
      
      // Should show validation error and stay open
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('text=/outside/')).toBeVisible();
      
      await dialog.locator('button').filter({ hasText: 'Cancel' }).click();
    }
  );
});
