import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  editorState,
  expectEditorMarkdown,
  setEditorMarkdown,
} from './editor-helpers.js';
import { killServer, launchServer } from './helpers.js';

test.describe('Bug fixes TDD', () => {
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
    expect(pageErrors, `page errors: ${pageErrors.map(e => e.message).join('; ')}`).toEqual([]);
  });

  test('Insert Citation toolbar button clicks triggers Zotero citation flow, not save flow', async ({
    page,
  }) => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-citation-'));
    const savePath = join(saveDir, 'doc.md');
    writeFileSync(savePath, '# Document\n', 'utf-8');
    const server = await launchServer(undefined, savePath);

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // Mock the Zotero API response on the client side
      await page.route('**/api/zotero/cite', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ citation: '[@Cox35]' }),
        });
      });

      // Click the toolbar citation button
      await page.getByRole('button', { name: 'Insert Citation' }).click();

      // The citation [@Cox35] should be inserted at the cursor (at position 0, before '# Document')
      await expectEditorMarkdown(page, '[@Cox35]# Document\n');

      // FileSelectorDialog (from the save flow) must not be visible
      await expect(page.getByTestId('file-selector-dialog')).toHaveCount(0);
    } finally {
      await killServer(server);
    }
  });

  test('persistMarkdown error handling displays toast notification', async ({
    page,
  }) => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-persist-err-'));
    const savePath = join(saveDir, 'doc.md');
    writeFileSync(savePath, '# Document\n', 'utf-8');
    const server = await launchServer(undefined, savePath);

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // Make /api/save fail with a 500 Internal Server Error
      await page.route('**/api/save', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Disk is completely full' }),
        });
      });

      // Modify document to trigger saveState as dirty
      await setEditorMarkdown(page, '# Document\nmodified');

      // Click save
      await page.getByRole('button', { name: 'Save' }).first().click();

      // Expect saveState to be error
      await expect(page.locator('#save-state')).toContainText('error');

      // A toast with "Disk is completely full" should be visible
      await expect(page.locator('ol[tabindex="-1"]')).toContainText('Disk is completely full');
    } finally {
      await killServer(server);
    }
  });

  test('createNewFile error handling displays toast notification', async ({
    page,
  }) => {
    const server = await launchServer();

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // Make /api/files/new fail with a 500 Internal Server Error
      await page.route('**/api/files/new', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Permission denied in workspace' }),
        });
      });

      // Click File -> New
      await page.getByRole('menuitem', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'New', exact: true }).click();

      // Fill in new path in selector dialog
      await page.locator('.fixed.inset-0 input').fill('colliding.md');
      await page.locator('.fixed.inset-0 button:not([disabled])').last().click();

      // A toast with "Permission denied in workspace" should be visible
      await expect(page.locator('ol[tabindex="-1"]')).toContainText('Permission denied in workspace');
    } finally {
      await killServer(server);
    }
  });

  test('isCurrent file highlighting inside Explorer works exactly rather than matching suffix', async ({
    page,
  }) => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-exact-highlight-'));
    const savePath = join(saveDir, 'chapter.md');
    writeFileSync(savePath, '# Chapter\n', 'utf-8');

    // Launch server with workspace root at saveDir
    const server = await launchServer(undefined, savePath);

    try {
      // Set current file to an absolute path outside the workspace that has the same suffix using addInitScript
      const externalSuffixPath = '/tmp/other-workspace/chapter.md';
      await page.addInitScript((path) => {
        Object.defineProperty(window, '__INITIAL_FILE', {
          value: path,
          writable: false,
          configurable: false,
        });
      }, externalSuffixPath);

      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // Open explorer
      await page.getByRole('menuitem', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'Open', exact: true }).click();

      await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });

      // The folder should contain chapter.md. With the endsWith bug, it would STILL highlight
      // chapter.md inside the explorer because the path ends with "chapter.md".
      // With the fix, it should NOT highlight it because it is a different absolute file!
      const chapterBtn = page.getByRole('button', { name: /chapter\.md/ });
      await expect(chapterBtn).toBeVisible();
      await expect(chapterBtn).not.toHaveClass(/bg-\[#2d3a4a\]/);
    } finally {
      await killServer(server);
    }
  });

  test('Save As on existing file prompts for confirmation and can be cancelled or approved', async ({
    page,
  }) => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-overwrite-confirm-'));
    const savePath = join(saveDir, 'doc.md');
    const existingPath = join(saveDir, 'existing.md');
    writeFileSync(savePath, '# Original Document\n', 'utf-8');
    writeFileSync(existingPath, '# Clashing File\n', 'utf-8');

    const server = await launchServer(undefined, savePath);

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // Change content
      await setEditorMarkdown(page, '# Overwritten Document\n');

      // Trigger Save As
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+S' : 'Control+Shift+S');
      await expect(page.getByTestId('file-selector-dialog')).toBeVisible({ timeout: 5000 });

      // Fill existing.md in the file input
      await page.locator('.fixed.inset-0 input').fill('existing.md');

      // Setup dialog handler to dismiss (Cancel)
      let dialogPrompted = false;
      page.once('dialog', async (dialog) => {
        dialogPrompted = true;
        expect(dialog.message()).toContain('already exists. Do you want to replace it?');
        await dialog.dismiss();
      });

      // Click save
      await page.locator('.fixed.inset-0 button:not([disabled])').last().click();

      // Expect dialog to have been prompted and file-selector-dialog to still be visible
      await expect(page.getByTestId('file-selector-dialog')).toBeVisible({ timeout: 5000 });
      expect(dialogPrompted).toBe(true);

      // Now click save again but approve overwrite
      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toContain('already exists. Do you want to replace it?');
        await dialog.accept();
      });

      await page.locator('.fixed.inset-0 button:not([disabled])').last().click();

      // Dialog should close, and existing.md should be overwritten with '# Overwritten Document\n'
      await expect(page.getByTestId('file-selector-dialog')).toHaveCount(0);
      await expect
        .poll(() => existsSync(existingPath) ? readFileSync(existingPath, 'utf-8') : null, {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe('# Overwritten Document\n');
    } finally {
      await killServer(server);
    }
  });
});
