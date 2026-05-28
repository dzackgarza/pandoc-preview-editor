import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
      const dialogPromise1 = page.waitForEvent('dialog');

      // Click save
      await page.locator('.fixed.inset-0 button:not([disabled])').last().click();

      // Wait for the dialog to appear and dismiss it
      const dialog1 = await dialogPromise1;
      expect(dialog1.message()).toContain('already exists. Do you want to replace it?');
      await dialog1.dismiss();

      // Expect file-selector-dialog to still be visible
      await expect(page.getByTestId('file-selector-dialog')).toBeVisible({ timeout: 5000 });

      // Now click save again but approve overwrite
      const dialogPromise2 = page.waitForEvent('dialog');

      await page.locator('.fixed.inset-0 button:not([disabled])').last().click();

      const dialog2 = await dialogPromise2;
      expect(dialog2.message()).toContain('already exists. Do you want to replace it?');
      await dialog2.accept();

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

  test('Successful plugin run displays toast with clickable output link which calls open-file', async ({
    page,
  }) => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-plugin-link-'));
    const savePath = join(saveDir, 'doc.md');
    const expectedPdfPath = join(saveDir, 'doc.pdf');
    writeFileSync(savePath, '# Document to Export\n', 'utf-8');

    const server = await launchServer(undefined, savePath);

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // Record any POST request to /api/open-file
      let openFileRequestedPath: string | null = null;
      await page.route('**/api/open-file', async (route) => {
        const postData = route.request().postDataJSON() as { path?: string };
        openFileRequestedPath = postData.path ?? null;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      });

      // Open Plugin -> Export -> Export to PDF
      await page.getByRole('menuitem', { name: 'Plugin' }).click();
      await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Export to PDF', exact: true }).click();

      // Wait for success toast to appear
      const toastLocator = page.locator('ol[tabindex="-1"]');
      await expect(toastLocator).toContainText('Export to PDF', { timeout: 10000 });
      await expect(toastLocator).toContainText('Output: doc.pdf');

      // Click the output link inside the toast
      const openBtn = toastLocator.getByRole('button', { name: 'doc.pdf' });
      await expect(openBtn).toBeVisible();
      await openBtn.click();

      // Expect /api/open-file to have been requested with the correct absolute path
      await expect.poll(() => openFileRequestedPath).toBe(expectedPdfPath);
    } finally {
      await killServer(server);
    }
  });

  test('beforeunload is triggered when document is dirty', async ({ page }) => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-beforeunload-'));
    const savePath = join(saveDir, 'doc.md');
    writeFileSync(savePath, '# Document\n', 'utf-8');
    const server = await launchServer(undefined, savePath);

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // Modify document to trigger saveState as dirty
      await setEditorMarkdown(page, '# Document\nmodified');

      // Setup dialog listener to catch the beforeunload prompt and dismiss it
      let beforeUnloadTriggered = false;
      const handleDialog = async (dialog: import('@playwright/test').Dialog) => {
        if (dialog.type() === 'beforeunload') {
          beforeUnloadTriggered = true;
          await dialog.dismiss();
        }
      };
      page.on('dialog', handleDialog);

      // Try to reload page
      try {
        await page.reload({ timeout: 3000 });
      } catch (err) {
        // Expected navigation cancel
      }

      // Cleanup listener so it doesn't block page teardown!
      page.off('dialog', handleDialog);

      // Verify the dialog was indeed triggered
      expect(beforeUnloadTriggered).toBe(true);

      // Verify we stayed on the modified page and text is still there
      await expectEditorMarkdown(page, '# Document\nmodified');
    } finally {
      await killServer(server);
    }
  });

  test('UnsavedChangesDialog is triggered when clicking another file in Explorer and Cancel, Discard, and Save work correctly', async ({
    page,
  }) => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-unsaved-dialog-'));
    const doc1Path = join(saveDir, 'doc1.md');
    const doc2Path = join(saveDir, 'doc2.md');
    writeFileSync(doc1Path, '# Document 1\n', 'utf-8');
    writeFileSync(doc2Path, '# Document 2\n', 'utf-8');

    const server = await launchServer(undefined, doc1Path);

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // 1. Modify Document 1 to make it dirty
      await setEditorMarkdown(page, '# Document 1\nmodified');

      // 2. Open Explorer drawer
      await page.getByRole('menuitem', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
      await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });

      // 3. Click doc2.md in explorer tree
      const doc2Btn = page.getByRole('button', { name: /doc2\.md/ });
      await expect(doc2Btn).toBeVisible();
      await doc2Btn.click();

      // 4. Expect UnsavedChangesDialog to be visible
      const unsavedModal = page.getByRole('heading', { name: 'Unsaved Changes' });
      await expect(unsavedModal).toBeVisible({ timeout: 5000 });

      // 5. Click Cancel
      await page.locator('.fixed.inset-0').getByRole('button', { name: 'Cancel' }).click();

      // 6. Verify we stay on doc1.md and it is still dirty with modified content
      await expect(unsavedModal).not.toBeVisible();
      await expectEditorMarkdown(page, '# Document 1\nmodified');
      await expect(page.locator('#save-state')).toContainText('unsaved');

      // 7. Click doc2.md again, click Discard
      await doc2Btn.click();
      await expect(unsavedModal).toBeVisible();
      await page.locator('.fixed.inset-0').getByRole('button', { name: 'Discard' }).click();

      // 8. Verify we successfully switched to doc2.md and original doc1.md on disk was NOT modified
      await expect(unsavedModal).not.toBeVisible();
      await expectEditorMarkdown(page, '# Document 2\n');
      expect(readFileSync(doc1Path, 'utf-8')).toBe('# Document 1\n');

      // 9. Now switch back to doc1.md (it should switch immediately because we are clean on doc2.md)
      const doc1Btn = page.getByRole('button', { name: /doc1\.md/ });
      await doc1Btn.click();
      await expectEditorMarkdown(page, '# Document 1\n');

      // 10. Make doc1 dirty again, switch to doc2, and choose Save
      await setEditorMarkdown(page, '# Document 1\nmodified again');
      await doc2Btn.click();
      await expect(unsavedModal).toBeVisible();
      await page.locator('.fixed.inset-0').getByRole('button', { name: 'Save' }).click();

      // 11. Verify we switched to doc2.md and doc1.md on disk was successfully updated!
      await expect(unsavedModal).not.toBeVisible();
      await expectEditorMarkdown(page, '# Document 2\n');
      expect(readFileSync(doc1Path, 'utf-8')).toBe('# Document 1\nmodified again');
    } finally {
      await killServer(server);
    }
  });
});
