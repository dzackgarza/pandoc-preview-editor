import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setEditorMarkdown } from './editor-helpers.js';
import { killServer, launchServer } from './helpers.js';
import { writeFileSyncAtomic } from '../server/workspace.js';

test.describe('File Integrity TDD', () => {
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
    expect(pageErrors, `page errors: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([]);
  });

  test('writeFileSyncAtomic safely writes content to the target file', () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-atomic-'));
    const targetPath = join(saveDir, 'doc.md');

    // 1. Initial write
    writeFileSyncAtomic(targetPath, 'Hello Atomic World');
    expect(readFileSync(targetPath, 'utf-8')).toBe('Hello Atomic World');

    // 2. Overwrite
    writeFileSyncAtomic(targetPath, 'New Content');
    expect(readFileSync(targetPath, 'utf-8')).toBe('New Content');
  });

  test('writeFileSyncAtomic leaves the original file intact if write fails', () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-atomic-fail-'));
    const targetPath = join(saveDir, 'doc.md');
    writeFileSync(targetPath, 'Original Safe Content', 'utf-8');

    // Attempting to write to an invalid path nested under a non-existent directory
    // with writeFileSyncAtomic should fail and leave original intact
    const invalidPath = join(saveDir, 'nonexistent-subdir/target.md');
    expect(() => writeFileSyncAtomic(invalidPath, 'Fail')).toThrow();

    // The original file is at targetPath, let's verify it is still intact
    expect(readFileSync(targetPath, 'utf-8')).toBe('Original Safe Content');
  });

  test('Save operation detects external modification and warns the user', async ({ page }) => {
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-conflict-'));
    const savePath = join(saveDir, 'doc.md');
    writeFileSync(savePath, '# Chapter 1\nContent of chapter 1.', 'utf-8');

    const server = await launchServer(undefined, savePath);

    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // Simulate external modification on disk
      writeFileSync(savePath, '# Chapter 1\nContent modified by an external editor!', 'utf-8');

      // Attempt to save inside the app
      await setEditorMarkdown(page, '# Chapter 1\nContent modified in the app.');
      await page.getByRole('button', { name: 'Save' }).first().click();

      // Expect saveState to transition to error and show a toast/modal about external changes
      await expect(page.locator('#save-state')).toContainText('error');

      // A toast with conflict warning should be visible
      const toast = page.locator('ol[tabindex="-1"]');
      await expect(toast).toContainText(/modified externally|out of sync|conflict/i);

      // Verify the file on disk was NOT overwritten by the client save
      const diskContent = readFileSync(savePath, 'utf-8');
      expect(diskContent).toContain('external editor!');
      expect(diskContent).not.toContain('in the app.');
    } finally {
      await killServer(server);
    }
  });
});
