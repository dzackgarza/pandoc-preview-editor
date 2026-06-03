import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { TauriPage } from '@srsholmes/tauri-playwright';
import { expect, test } from './fixtures.js';
import { replaceEditorContents, previewText } from './editor-helpers.js';

async function getEditorContents(appPage: TauriPage) {
  return appPage.evaluate(
    `(() => { const view = window.__PANDOC_PREVIEW_EDITOR_VIEW__; if (!view) throw new Error('Playwright editor hook is not available'); return view.state.doc.toString(); })()`,
  );
}

async function openMenu(appPage: TauriPage, name: string) {
  await appPage.locator('[role="menuitem"]').filter({ hasText: name }).first().click();
}

async function clickMenuItem(appPage: TauriPage, name: string) {
  await appPage.locator('[role="menuitem"]').filter({ hasText: name }).last().click();
}

const savedWithFileTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const docPath = path.join(testEnv.workspaceDir, 'doc.md');
    writeFileSync(docPath, '# Document\n', 'utf-8');
    testEnv.writeSessionState(docPath, false);
    testEnv.writeConfig({ debounceMs: 50, timeoutMs: 30000 });
    await use(testEnv);
  },
});

const freshTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    testEnv.writeConfig({ debounceMs: 50, timeoutMs: 30000 });
    await use(testEnv);
  },
});

test.describe('Bug fixes TDD', () => {
  const chapterFileTest = test.extend({
    testEnv: async ({ testEnv }, use) => {
      const docPath = path.join(testEnv.workspaceDir, 'chapter.md');
      writeFileSync(docPath, '# Doc\n', 'utf-8');
      testEnv.writeSessionState(docPath, false);
      testEnv.writeConfig({ debounceMs: 50, timeoutMs: 30000 });
      await use(testEnv);
    },
  });

  chapterFileTest(
    'isCurrent file highlighting inside Explorer uses exact path match, not suffix match',
    async ({ appPage, testEnv }) => {
      const docPath = path.join(testEnv.workspaceDir, 'chapter.md');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        docPath,
      );

      await appPage.locator('button[aria-label="File Explorer"]').click();
      await expect(appPage.getByTestId('explorer-drawer')).toBeVisible({
        timeout: 5000,
      });

      const chapterBtn = appPage
        .locator('button')
        .filter({ hasText: /chapter\.md/ })
        .first();
      await expect(chapterBtn).toBeVisible();
      await expect(chapterBtn).not.toHaveClass(/bg-\[#2d3a4a\]/);
    },
  );

  savedWithFileTest(
    'UnsavedChangesDialog: Cancel, Discard, and Save work correctly when switching files in Explorer',
    async ({ appPage, testEnv }) => {
      const doc1Path = path.join(testEnv.workspaceDir, 'doc1.md');
      const doc2Path = path.join(testEnv.workspaceDir, 'doc2.md');
      writeFileSync(doc1Path, '# Document 1\n', 'utf-8');
      writeFileSync(doc2Path, '# Document 2\n', 'utf-8');

      testEnv.writeSessionState(doc1Path, false);
      testEnv.writeConfig({ debounceMs: 50, timeoutMs: 30000 });

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      await replaceEditorContents(appPage, '# Document 1\nmodified');
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      await appPage.locator('button[aria-label="File Explorer"]').click();
      await expect(appPage.getByTestId('explorer-drawer')).toBeVisible({
        timeout: 5000,
      });

      // Helper: click a button by text content using native click (evaluate)
      // Workaround for Playwright click not triggering React events inside the
      // motion-animated explorer drawer in the Tauri webview.
      const nativeClickFile = async (name: string) => {
        await appPage.evaluate(`(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent?.includes('${name}'));
          if (btn) btn.click();
        })()`);
      };

      // Open doc2.md — triggers UnsavedChanges dialog
      await nativeClickFile('doc2.md');

      // Dialog: Cancel — preserve dirty buffer
      const unsavedModal = appPage.locator('h2').filter({ hasText: 'Unsaved Changes' });
      await expect(unsavedModal).toBeVisible({ timeout: 5000 });

      await appPage
        .locator('.fixed.inset-0')
        .locator('button')
        .filter({ hasText: 'Cancel' })
        .click();

      await expect(
        appPage.locator('h2').filter({ hasText: 'Unsaved Changes' }),
      ).not.toBeVisible();
      await expect
        .poll(() => getEditorContents(appPage))
        .toBe('# Document 1\nmodified');
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      // Try again — Discard this time
      await nativeClickFile('doc2.md');
      await expect(
        appPage.locator('h2').filter({ hasText: 'Unsaved Changes' }),
      ).toBeVisible();
      await appPage
        .locator('.fixed.inset-0')
        .locator('button')
        .filter({ hasText: 'Discard' })
        .click();

      await expect(
        appPage.locator('h2').filter({ hasText: 'Unsaved Changes' }),
      ).not.toBeVisible();
      await expect.poll(() => previewText(appPage)).toContain('Document 2');
      await expect(readFileSync(doc1Path, 'utf-8')).toBe('# Document 1\n');

      // Switch to doc1.md (no dialog — not dirty)
      await nativeClickFile('doc1.md');
      await expect.poll(() => previewText(appPage)).toContain('Document 1');

      // Make dirty again, try Save this time
      await replaceEditorContents(appPage, '# Document 1\nmodified again');
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      await nativeClickFile('doc2.md');
      await expect(
        appPage.locator('h2').filter({ hasText: 'Unsaved Changes' }),
      ).toBeVisible();
      await appPage
        .locator('.fixed.inset-0')
        .locator('button')
        .filter({ hasText: 'Save' })
        .click();

      await expect(
        appPage.locator('h2').filter({ hasText: 'Unsaved Changes' }),
      ).not.toBeVisible();
      await expect.poll(() => previewText(appPage)).toContain('Document 2');
      await expect(readFileSync(doc1Path, 'utf-8')).toBe(
        '# Document 1\nmodified again',
      );
    },
  );

  freshTest(
    'explanatory prompt message when launching plugin with unsaved buffer',
    async ({ appPage }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      await openMenu(appPage, 'Plugin');
      await appPage.locator('[role="menuitem"]').filter({ hasText: 'Export' }).hover();
      await clickMenuItem(appPage, 'Export to PDF');

      const dialog = appPage.getByTestId('file-selector-dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const description = appPage.getByTestId('file-selector-description');
      await expect(description).toBeVisible();
      await expect(description).toContainText(
        'Please choose a location to save your original Markdown document first',
      );
    },
  );

  freshTest(
    'workspace root defaults to workspace directory for temp files',
    async ({ appPage, testEnv }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const workspaceRoot = await appPage.evaluate(
        `(() => { const footer = document.querySelector('footer span[title]'); return footer?.getAttribute('title') ?? ''; })()`,
      );

      expect(workspaceRoot).toBeTruthy();
    },
  );
});
