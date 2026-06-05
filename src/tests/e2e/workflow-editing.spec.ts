import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures.js';
import {
  replaceEditorContents,
  previewText,
  saveViaFileSelector,
  invokeTauri,
} from './editor-helpers.js';

const editingWorkflowTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const notesDir = path.join(testEnv.workspaceDir, 'notes');
    const nestedDir = path.join(testEnv.workspaceDir, 'nested');
    const ignoredDir = path.join(testEnv.workspaceDir, 'node_modules');

    mkdirSync(notesDir, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(ignoredDir, { recursive: true });

    const docPath = path.join(notesDir, 'proof.md');
    writeFileSync(docPath, '# Launch proof\n\nInitial content from disk.\n', 'utf8');
    writeFileSync(path.join(nestedDir, 'chapter.md'), '# Chapter\n\nInitial chapter.\n', 'utf8');
    writeFileSync(path.join(ignoredDir, 'ignored.md'), 'ignored', 'utf8');
    writeFileSync(path.join(testEnv.workspaceDir, '.hidden.md'), 'hidden', 'utf8');

    testEnv.writeSessionState(docPath, false);
    await use(testEnv);
  },
});

test.describe('Desktop Editing Workflow (Consolidated)', () => {
  editingWorkflowTest(
    'exercises full session: launch, edit, save, navigate, save-as, reload, and recovery',
    async ({ appPage, testEnv }) => {
      const docPath = path.join(testEnv.workspaceDir, 'notes', 'proof.md');
      const chapterPath = path.join(testEnv.workspaceDir, 'nested', 'chapter.md');
      const saveAsPath = path.join(testEnv.workspaceDir, 'notes', 'saved-as.md');

      // 1. Initial State Proof
      await expect(appPage.getByTestId('editor')).toBeVisible();
      await expect(appPage.locator('footer span[title]')).toHaveAttribute('title', docPath);
      await expect(appPage.locator('.cm-content')).toContainText('Initial content from disk.');
      await expect.poll(() => previewText(appPage)).toContain('Launch proof');

      // 2. Editing & Preview State
      const updatedMarkdown = '# Launch proof\n\nEdited content.\n';
      await replaceEditorContents(appPage, updatedMarkdown);
      await expect(appPage.locator('#save-state')).toHaveAttribute('data-state', 'dirty');
      await expect.poll(() => previewText(appPage)).toContain('Edited content.');

      // 3. Undo/Redo Check
      await appPage.keyboard.press('Control+z');
      await expect(appPage.locator('.cm-content')).toContainText('Initial content from disk.');
      await appPage.keyboard.press('Control+y');
      await expect(appPage.locator('.cm-content')).toContainText('Edited content.');

      // 4. Persistence (Save)
      await appPage.getByTestId('menu-trigger-file').click();
      await appPage.getByTestId('menu-item-save').click();
      await expect(appPage.locator('#save-state')).toHaveAttribute('data-state', 'saved');
      expect(readFileSync(docPath, 'utf8')).toBe(updatedMarkdown);

      // 5. Explorer Navigation & Dirty State Hand-off
      await appPage.locator('button[aria-label="File Explorer"]').click();
      const explorer = appPage.getByTestId('explorer-drawer');
      await expect(explorer).toBeVisible();
      await expect(explorer.getByTestId('explorer-file-proof.md')).toBeVisible();
      await expect(explorer.getByTestId('explorer-dir-nested')).toBeVisible();
      await expect(explorer).not.toContainText('node_modules'); // Filtered

      // Navigate to another file
      await explorer.getByTestId('explorer-dir-nested').click();
      await explorer.getByTestId('explorer-file-chapter.md').click();
      await expect(appPage.locator('footer span[title]')).toHaveAttribute('title', chapterPath);
      await expect.poll(() => previewText(appPage)).toContain('Initial chapter');

      // 6. Save As (Workspace Shift)
      await replaceEditorContents(appPage, '# Saved As\n\nInside workspace.\n');
      await appPage.keyboard.press('Control+Shift+S');
      await saveViaFileSelector(appPage, saveAsPath);
      await expect(appPage.locator('footer span[title]')).toHaveAttribute('title', saveAsPath);
      expect(readFileSync(saveAsPath, 'utf8')).toBe('# Saved As\n\nInside workspace.\n');

      // 7. Session Persistence (Reload)
      await appPage.reload();
      await expect(appPage.getByTestId('editor')).toBeVisible();
      await expect(appPage.locator('footer span[title]')).toHaveAttribute('title', saveAsPath);
      await expect(appPage.locator('.cm-content')).toContainText('Inside workspace.');

      // 8. Backup Recovery Proof
      const recoveryMarkdown = '# Recovered\n\nDirty content.\n';
      await replaceEditorContents(appPage, recoveryMarkdown);
      await expect(appPage.locator('#save-state')).toHaveAttribute('data-state', 'dirty');
      
      // Wait for the background backup signal
      await expect.poll(async () => {
        const attr = await appPage.locator('#save-state').getAttribute('data-backup-saved');
        return parseInt(attr || '0', 10);
      }, { timeout: 5000 }).toBeGreaterThan(0);
      
      await appPage.reload(); // Simulate crash/restart
      await expect(appPage.getByTestId('editor')).toBeVisible();
      await expect(appPage.locator('.cm-content')).toContainText('Dirty content.');
    }
  );
});
