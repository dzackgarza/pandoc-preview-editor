import { expect, test } from '@playwright/test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killServer, launchServer } from './helpers.js';
import { load } from 'js-toml';

test.describe('Settings and Preferences TDD', () => {
  let pageErrors: Error[] = [];
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== 'passed') return;
    expect(
      pageErrors,
      `page errors: ${pageErrors.map((e) => e.message).join('; ')}`,
    ).toEqual([]);
  });

  test('Settings dialog opens, supports bidirectional sync, persists to TOML, and validates paths', async ({
    page,
  }) => {
    const testDir = mkdtempSync(join(tmpdir(), 'pandoc-settings-'));
    const docPath = join(testDir, 'doc.md');
    const tomlPath = join(testDir, 'pandoc-preview.toml');

    writeFileSync(docPath, '# Document\n', 'utf-8');

    // Create custom pandoc-preview.toml in the test directory
    const initialToml = `
[render]
debounce_ms = 750
timeout_ms = 30000

[pandoc]
render_command = "pandoc -f markdown -t html --standalone --template=${testDir}/templates/MakeMeAQual_template.html"
templates_dir = "${testDir}/templates"
filters_dir = "${testDir}/filters"
`;
    writeFileSync(tomlPath, initialToml, 'utf-8');

    // Create the dummy directories for templates and filters so scanner doesn't fail
    const templatesDir = join(testDir, 'templates');
    const filtersDir = join(testDir, 'filters');
    mkdirSync(templatesDir, { recursive: true });
    mkdirSync(filtersDir, { recursive: true });

    // Write some dummy templates/filters inside
    writeFileSync(join(templatesDir, 'custom.html'), '<html>$body$</html>', 'utf-8');
    writeFileSync(join(filtersDir, 'my-filter.lua'), '-- Lua filter', 'utf-8');

    const server = await launchServer(undefined, docPath, tomlPath);

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // 1. Open the settings dialog
      await page.getByRole('menuitem', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'Preferences...' }).click();

      // Settings dialog should be visible (using role dialog)
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // 2. Verify initial states from the TOML config
      // Navigate to the Pandoc Configuration tab
      await dialog.getByRole('tab', { name: 'Pandoc Configuration' }).click();
      const standaloneCheckbox = dialog.locator('input[aria-label="Standalone"]');
      await expect(standaloneCheckbox).toBeChecked();

      // Citeproc should NOT be checked
      const citeprocCheckbox = dialog.locator('input[aria-label="Citeproc"]');
      await expect(citeprocCheckbox).not.toBeChecked();

      // 3. Test sync: GUI to Raw textarea
      // Click Citeproc
      await citeprocCheckbox.click();

      // Navigate to Raw Command tab to verify sync
      await dialog.getByRole('tab', { name: 'Raw Command' }).click();
      const argsTextarea = dialog.locator('textarea[aria-label="Render Command"]');
      await expect(argsTextarea).toHaveValue(/--citeproc/);

      // Verify initial parsed arguments show --standalone and not --citeproc (before our edit)
      // Since we clicked citeproc in the previous step, --citeproc should now be present
      const initialArgs = await argsTextarea.inputValue();
      expect(initialArgs).toContain('--standalone');
      expect(initialArgs).toContain('--citeproc');

      // 4. Test sync: Raw textarea to GUI
      // Uncheck standalone by editing textarea
      const updatedValue = initialArgs.replace('--standalone', '').trim();
      await argsTextarea.fill(updatedValue);

      // Go back to Pandoc Configuration tab to verify the checkbox un-checked
      await dialog.getByRole('tab', { name: 'Pandoc Configuration' }).click();
      await expect(standaloneCheckbox).not.toBeChecked();

      // 5. Check persistence by saving
      await page.getByRole('button', { name: 'Apply' }).click();
      // Dialog should close
      await expect(dialog).not.toBeVisible();

      // Verify TOML file on disk has been updated
      const savedTomlContent = readFileSync(tomlPath, 'utf-8');
      const parsedToml = load(savedTomlContent) as any;
      expect(parsedToml.pandoc.render_command).toContain('--citeproc');
      expect(parsedToml.pandoc.render_command).not.toContain('--standalone');

      // 6. Test escaping path validation error
      // Open settings dialog again
      await page.getByRole('menuitem', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'Preferences...' }).click();
      await expect(dialog).toBeVisible();

      // Edit raw textarea to include an escaping template path
      await dialog.getByRole('tab', { name: 'Raw Command' }).click();
      const escapeArgs = `pandoc --standalone --template=/tmp/escape.html`;
      await argsTextarea.fill(escapeArgs);

      // Click Apply
      await page.getByRole('button', { name: 'Apply' }).click();

      // Expect dialog to remain open (since validation fails)
      await expect(dialog).toBeVisible();

      // An inline validation error should appear in the dialog
      await expect(
        dialog.getByText('is external. Please place it in the templates directory'),
      ).toBeVisible();

      // Close settings via Cancel
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
    } finally {
      await killServer(server);
    }
  });

  test('Preferences fullscreen overhaul, unified Lua filters, and plugins library', async ({
    page,
  }) => {
    const testDir = mkdtempSync(join(tmpdir(), 'pandoc-fullscreen-settings-'));
    const docPath = join(testDir, 'doc.md');
    const tomlPath = join(testDir, 'pandoc-preview.toml');

    writeFileSync(docPath, '# Document\n', 'utf-8');

    // Create custom pandoc-preview.toml in the test directory
    const initialToml = `
[render]
debounce_ms = 750
timeout_ms = 30000

[pandoc]
render_command = "pandoc -f markdown -t html --standalone --template=${testDir}/templates/custom.html"
templates_dir = "${testDir}/templates"
filters_dir = "${testDir}/filters"
`;
    writeFileSync(tomlPath, initialToml, 'utf-8');

    const templatesDir = join(testDir, 'templates');
    const filtersDir = join(testDir, 'filters');
    mkdirSync(templatesDir, { recursive: true });
    mkdirSync(filtersDir, { recursive: true });

    writeFileSync(join(templatesDir, 'custom.html'), '<html>\$body\$</html>', 'utf-8');
    writeFileSync(join(filtersDir, 'test-fullscreen-filter.lua'), '-- Lua filter', 'utf-8');

    const server = await launchServer(undefined, docPath, tomlPath);

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // 1. Open the preferences dialog
      await page.getByRole('menuitem', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'Preferences...' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // 2. Assert high-viewport overlay dimensions (fullscreen/large settings)
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        // Assert width and height are large: at least 80% viewport width and height
        // Standard playwright viewport is 1280x720. Let's assert width >= 800 and height >= 500.
        expect(box.width).toBeGreaterThanOrEqual(800);
        expect(box.height).toBeGreaterThanOrEqual(500);
      }

      // 3. Verify tabs in the vertical sidebar
      const tabs = ['General', 'Pandoc Configuration', 'Lua Filters', 'Asset Resolution', 'Plugins'];
      for (const tab of tabs) {
        await expect(dialog.getByRole('tab', { name: tab })).toBeVisible();
      }

      // 4. Test unified Lua Filters tab
      await dialog.getByRole('tab', { name: 'Lua Filters' }).click();
      // Should show the scanning header or directory setting
      await expect(dialog.getByLabel('Filters Directory')).toHaveValue(filtersDir);
      // Should display our custom filter inside the list
      await expect(dialog.getByText('test-fullscreen-filter.lua', { exact: true })).toBeVisible();

      // 5. Test Plugins tab
      await dialog.getByRole('tab', { name: 'Plugins' }).click();
      // Should list bundled plugins, e.g. "Export to PDF"
      await expect(dialog.getByText('Export to PDF')).toBeVisible();
      await expect(dialog.getByText('Convert the current markdown file to PDF with Pandoc')).toBeVisible();

      // Close the settings via Cancel
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
    } finally {
      await killServer(server);
    }
  });
});

