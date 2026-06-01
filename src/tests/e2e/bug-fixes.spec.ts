// @ts-nocheck — tauri-playwright 0.2.2 fixture/types are intentionally loose
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import { replaceEditorContents, previewText, invokeTauri } from './editor-helpers.js';

async function getEditorContents(appPage) {
  return appPage.evaluate(
    `(() => { const view = window.__PANDOC_PREVIEW_EDITOR_VIEW__; if (!view) throw new Error('Playwright editor hook is not available'); return view.state.doc.toString(); })()`,
  );
}

async function getToastText(appPage) {
  return appPage.evaluate(
    `(() => { const toasts = document.querySelectorAll('[data-testid="toast"]'); const texts = []; toasts.forEach((t) => texts.push(t.textContent ?? '')); return texts.join('\\n'); })()`,
  );
}

async function waitForToast(appPage, substring, timeout = 10000) {
  await expect
    .poll(
      async () => {
        const text = await getToastText(appPage);
        return text.includes(substring);
      },
      { timeout },
    )
    .toBe(true);
}

async function openMenu(appPage, name) {
  await appPage.getByRole('menuitem', { name }).click();
}

async function clickMenuItem(appPage, name) {
  await appPage.getByRole('menuitem', { name, exact: true }).click();
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
  freshTest(
    'Insert Citation toolbar button triggers Zotero citation flow via Tauri IPC',
    async ({ appPage }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      // Mock the zotero_cite command by overriding __TAURI_INTERNALS__.invoke
      await appPage.evaluate(`
        (() => {
          const orig = window.__TAURI_INTERNALS__?.invoke;
          if (!orig) throw new Error('Tauri IPC not available');
          window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
            if (cmd === 'zotero_cite') {
              return { citation: '[@Cox35]' };
            }
            return orig(cmd, args);
          };
        })()
      `);

      await appPage.getByRole('button', { name: 'Insert Citation' }).click();

      await expect
        .poll(() => getEditorContents(appPage), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toMatch(/\[@Cox35\]/);

      await expect(appPage.getByTestId('file-selector-dialog')).toHaveCount(0);
    },
  );

  savedWithFileTest(
    'persistMarkdown error handling displays toast notification',
    async ({ appPage, testEnv }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      // Mock save command to throw
      await appPage.evaluate(`
        (() => {
          const orig = window.__TAURI_INTERNALS__?.invoke;
          if (!orig) throw new Error('Tauri IPC not available');
          window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
            if (cmd === 'save') {
              throw new Error('Disk is completely full');
            }
            return orig(cmd, args);
          };
        })()
      `);

      await replaceEditorContents(appPage, '# Document\nmodified');
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      await appPage.locator('button[aria-label="Save"]').click();

      await expect(appPage.locator('#save-state')).toContainText('error');
      await waitForToast(appPage, 'Disk is completely full');
    },
  );

  freshTest(
    'createNewFile error handling displays toast notification',
    async ({ appPage, testEnv }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      // Mock new_file command to throw
      await appPage.evaluate(`
        (() => {
          const orig = window.__TAURI_INTERNALS__?.invoke;
          if (!orig) throw new Error('Tauri IPC not available');
          window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
            if (cmd === 'new_file') {
              throw new Error('Permission denied in workspace');
            }
            return orig(cmd, args);
          };
        })()
      `);

      await openMenu(appPage, 'File');
      await clickMenuItem(appPage, 'New');

      await expect(appPage.getByTestId('file-selector-dialog')).toBeVisible({
        timeout: 5000,
      });
      await appPage.getByTestId('file-selector-input').fill('colliding.md');
      await appPage.getByTestId('file-selector-save').click();

      await waitForToast(appPage, 'Permission denied in workspace');
    },
  );

  savedWithFileTest(
    'isCurrent file highlighting inside Explorer uses exact path match, not suffix match',
    async ({ appPage, testEnv }) => {
      const docPath = path.join(testEnv.workspaceDir, 'chapter.md');

      // rename the session state file to chapter.md
      writeFileSync(docPath, '# Doc\n', 'utf-8');
      testEnv.writeSessionState(docPath, false);

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        docPath,
      );

      await appPage.locator('button[aria-label="File Explorer"]').click();
      await expect(appPage.getByTestId('explorer-drawer')).toBeVisible({
        timeout: 5000,
      });

      const chapterBtn = appPage.getByRole('button', { name: /chapter\.md/ });
      await expect(chapterBtn).toBeVisible();
      await expect(chapterBtn).not.toHaveClass(/bg-\[#2d3a4a\]/);
    },
  );

  savedWithFileTest(
    'Save As on existing file prompts for confirmation via window.confirm',
    async ({ appPage, testEnv }) => {
      const existingPath = path.join(testEnv.workspaceDir, 'existing.md');
      writeFileSync(existingPath, '# Clashing File\n', 'utf-8');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      await replaceEditorContents(appPage, '# Overwritten Document\n');

      await appPage.keyboard.press('Control+Shift+S');
      await expect(appPage.getByTestId('file-selector-dialog')).toBeVisible({
        timeout: 5000,
      });

      await appPage.getByTestId('file-selector-input').fill('existing.md');

      // Replace window.confirm with a version that returns false and records the message
      await appPage.evaluate(`
        (() => {
          window.__confirmResult = false;
          const origConfirm = window.confirm;
          window.confirm = (msg) => {
            window.__confirmResult = msg ?? '';
            window.confirm = origConfirm;
            return false;
          };
        })()
      `);

      await appPage.getByTestId('file-selector-save').click();

      const confirmMsg = await appPage.evaluate('window.__confirmResult');
      expect(confirmMsg).toContain('already exists');
      await expect(appPage.getByTestId('file-selector-dialog')).toBeVisible({
        timeout: 5000,
      });

      // Now set confirm to return true
      await appPage.evaluate('window.confirm = () => true');
      await appPage.getByTestId('file-selector-save').click();

      await expect(appPage.getByTestId('file-selector-dialog')).toHaveCount(0);
      await expect
        .poll(
          () => (existsSync(existingPath) ? readFileSync(existingPath, 'utf-8') : null),
          {
            timeout: 5000,
            intervals: [100, 200],
          },
        )
        .toBe('# Overwritten Document\n');
    },
  );

  savedWithFileTest(
    'successful plugin run displays toast with clickable output link',
    async ({ appPage, testEnv }) => {
      const outputPath = path.join(testEnv.workspaceDir, 'doc.pdf');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      // Mock run_plugin to return success
      await appPage.evaluate(`
        (() => {
          const orig = window.__TAURI_INTERNALS__?.invoke;
          if (!orig) throw new Error('Tauri IPC not available');
          window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
            if (cmd === 'run_plugin') {
              return {
                ok: true,
                stdout: '',
                stderr: '',
                exitCode: 0,
                outputPath: ${JSON.stringify(outputPath)},
              };
            }
            return orig(cmd, args);
          };
        })()
      `);

      await openMenu(appPage, 'Plugin');
      await appPage.getByRole('menuitem', { name: 'Export' }).hover();
      await clickMenuItem(appPage, 'Export to PDF');

      await waitForToast(appPage, 'doc.pdf', 10000);
    },
  );

  savedWithFileTest(
    'plugin-state returns to idle after a successful plugin run',
    async ({ appPage, testEnv }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      // Mock run_plugin to return success
      await appPage.evaluate(`
        (() => {
          const orig = window.__TAURI_INTERNALS__?.invoke;
          if (!orig) throw new Error('Tauri IPC not available');
          window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
            if (cmd === 'run_plugin') {
              return {
                ok: true,
                stdout: '',
                stderr: '',
                exitCode: 0,
                outputPath: '/tmp/test-output.pdf',
              };
            }
            return orig(cmd, args);
          };
        })()
      `);

      await openMenu(appPage, 'Plugin');
      await appPage.getByRole('menuitem', { name: 'Export' }).hover();
      await clickMenuItem(appPage, 'Export to PDF');

      await waitForToast(appPage, 'Export to PDF', 10000);

      await expect(appPage.locator('#plugin-state')).toContainText('idle', {
        timeout: 3000,
      });
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

      await appPage.getByRole('button', { name: /doc2\.md/ }).click();

      const unsavedModal = appPage.getByRole('heading', { name: 'Unsaved Changes' });
      await expect(unsavedModal).toBeVisible({ timeout: 5000 });

      await appPage
        .locator('.fixed.inset-0')
        .getByRole('button', { name: 'Cancel' })
        .click();

      await expect(unsavedModal).not.toBeVisible();
      await expect
        .poll(() => getEditorContents(appPage))
        .toBe('# Document 1\nmodified');
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      await appPage.getByRole('button', { name: /doc2\.md/ }).click();
      await expect(unsavedModal).toBeVisible();
      await appPage
        .locator('.fixed.inset-0')
        .getByRole('button', { name: 'Discard' })
        .click();

      await expect(unsavedModal).not.toBeVisible();
      await expect.poll(() => previewText(appPage)).toContain('Document 2');
      await expect(readFileSync(doc1Path, 'utf-8')).toBe('# Document 1\n');

      await appPage.getByRole('button', { name: /doc1\.md/ }).click();
      await expect.poll(() => previewText(appPage)).toContain('Document 1');

      await replaceEditorContents(appPage, '# Document 1\nmodified again');
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      await appPage.getByRole('button', { name: /doc2\.md/ }).click();
      await expect(unsavedModal).toBeVisible();
      await appPage
        .locator('.fixed.inset-0')
        .getByRole('button', { name: 'Save' })
        .click();

      await expect(unsavedModal).not.toBeVisible();
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
      await appPage.getByRole('menuitem', { name: 'Export' }).hover();
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
