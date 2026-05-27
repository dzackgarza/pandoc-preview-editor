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

      // The citation [@Cox35] should be inserted at the cursor
      await expectEditorMarkdown(page, '# Document\n[@Cox35]');

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
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // Open explorer
      await page.getByRole('menuitem', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'Open', exact: true }).click();

      await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });

      // The folder should contain chapter.md. It should be highlighted because currentFile is exact.
      const chapterBtn = page.getByRole('button', { name: /chapter\.md/ });
      await expect(chapterBtn).toBeVisible();
      await expect(chapterBtn).toHaveClass(/bg-\[#2d3a4a\]/); // highlighted class

      // Set current file to an absolute path outside the workspace that has the same suffix
      const externalSuffixPath = '/tmp/other-workspace/chapter.md';
      await page.evaluate((path) => {
        window.__PANDOC_PREVIEW_STATE__!.currentFile = path;
      }, externalSuffixPath);

      // Trigger a light component re-render or wait for React.
      // With the endsWith bug, it would STILL highlight chapter.md inside the explorer because the
      // path ends with "chapter.md".
      // With the fix, it should NOT highlight it anymore because it is a different absolute file!
      await expect(chapterBtn).not.toHaveClass(/bg-\[#2d3a4a\]/);
    } finally {
      await killServer(server);
    }
  });
});
