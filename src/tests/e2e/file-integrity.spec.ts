import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import { replaceEditorContents, previewText } from './editor-helpers.js';

const savedFileTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const notesDir = path.join(testEnv.workspaceDir, 'notes');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(notesDir, { recursive: true });

    const documentPath = path.join(notesDir, 'integrity.md');
    writeFileSync(documentPath, '# Chapter 1\nContent of chapter 1.\n', 'utf-8');
    testEnv.writeSessionState(documentPath, false);

    await use(testEnv);
  },
});

test.describe('File Integrity (Tauri)', () => {
  savedFileTest(
    'save triggers atomic write — file on disk matches editor content',
    async ({ appPage, testEnv }) => {
      const documentPath = path.join(testEnv.workspaceDir, 'notes', 'integrity.md');

      await expect(appPage.getByTestId('editor')).toBeVisible();
      await expect.poll(() => previewText(appPage)).toContain('Chapter 1');
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        documentPath,
      );

      const updatedMarkdown = '# Chapter 1\nRewritten content from the editor.\n';
      await replaceEditorContents(appPage, updatedMarkdown);
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      await appPage.locator('button[aria-label="Save"]').click();
      await expect(appPage.locator('#save-state')).toContainText('saved');

      const diskContent = readFileSync(documentPath, 'utf-8');
      expect(diskContent).toBe(updatedMarkdown);
    },
  );

  savedFileTest(
    'save detects external modification and refuses to overwrite',
    async ({ appPage, testEnv }) => {
      const documentPath = path.join(testEnv.workspaceDir, 'notes', 'integrity.md');

      await expect(appPage.getByTestId('editor')).toBeVisible();
      await expect.poll(() => previewText(appPage)).toContain('Chapter 1');

      const externalMarkdown = '# Chapter 1\nContent modified by an external editor!\n';
      writeFileSync(documentPath, externalMarkdown, 'utf-8');

      await replaceEditorContents(
        appPage,
        '# Chapter 1\nContent modified in the app.\n',
      );
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      await appPage.locator('button[aria-label="Save"]').click();
      await expect(appPage.locator('#save-state')).toContainText('error');

      const diskContent = readFileSync(documentPath, 'utf-8');
      expect(diskContent).toContain('external editor!');
      expect(diskContent).not.toContain('in the app.');
    },
  );

  savedFileTest(
    'save and reload preserves exact content on disk',
    async ({ appPage, testEnv }) => {
      const documentPath = path.join(testEnv.workspaceDir, 'notes', 'integrity.md');

      await expect(appPage.getByTestId('editor')).toBeVisible();

      const editedMarkdown = '# Integrity Check\n\nReload verification.\n';
      await replaceEditorContents(appPage, editedMarkdown);
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      await appPage.locator('button[aria-label="Save"]').click();
      await expect(appPage.locator('#save-state')).toContainText('saved');

      expect(readFileSync(documentPath, 'utf-8')).toBe(editedMarkdown);

      await appPage.reload();
      await expect(appPage.getByTestId('editor')).toBeVisible();
      await expect(appPage.locator('#status')).toContainText('ready');
      await expect(appPage.locator('.cm-content')).toContainText(
        'Reload verification.',
      );
      await expect.poll(() => previewText(appPage)).toContain('Reload verification');

      expect(readFileSync(documentPath, 'utf-8')).toBe(editedMarkdown);
    },
  );
});
