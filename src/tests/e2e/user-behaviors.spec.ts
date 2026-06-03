import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import {
  replaceEditorContents,
  previewText,
  previewInnerHTML,
  saveViaFileSelector,
  type AppPage,
} from './editor-helpers.js';

async function getEditorContents(appPage: AppPage): Promise<string> {
  return appPage.evaluate(
    `(() => { const view = window.__PANDOC_PREVIEW_EDITOR_VIEW__; if (!view) throw new Error('Playwright editor hook is not available'); return view.state.doc.toString(); })()`,
  );
}

async function openMenu(appPage: AppPage, name: string): Promise<void> {
  await appPage.locator('[role="menuitem"]').filter({ hasText: name }).first().click();
}

async function clickMenuItem(appPage: AppPage, name: string): Promise<void> {
  await appPage.locator('[role="menuitem"]').filter({ hasText: name }).last().click();
}

const workSessionTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    testEnv.writeConfig({ debounceMs: 50, timeoutMs: 30000 });
    await use(testEnv);
  },
});

const workspaceTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const dir = testEnv.workspaceDir;
    const nested = path.join(dir, 'nested');
    const ignored = path.join(dir, 'node_modules');

    mkdirSync(nested, { recursive: true });
    mkdirSync(ignored, { recursive: true });

    const original = path.join(dir, 'original.md');
    const notes = path.join(dir, 'notes.txt');
    const chapter = path.join(nested, 'chapter.md');

    writeFileSync(original, '# Original\n\nKeep this file unchanged.', 'utf-8');
    writeFileSync(notes, 'Notes text.', 'utf-8');
    writeFileSync(chapter, '# Chapter\n\nInitial chapter.', 'utf-8');
    writeFileSync(path.join(ignored, 'ignored.md'), '# Ignored', 'utf-8');
    writeFileSync(path.join(dir, 'image.png'), Buffer.from([0, 1, 2, 3]));

    testEnv.writeSessionState(original, false);
    await use(testEnv);
  },
});

const pasteEventTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const saveDir = testEnv.workspaceDir;
    const savePath = path.join(saveDir, 'doc.md');
    writeFileSync(savePath, '# Paste Test\n', 'utf-8');
    testEnv.writeSessionState(savePath, false);
    await use(testEnv);
  },
});

test.describe('user workflows', () => {
  workSessionTest(
    'default document editing, saving, reload, and status display work together',
    async ({ appPage, testEnv }) => {
      const savePath = path.join(testEnv.workspaceDir, 'work-session.md');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('#preview')).toBeAttached();
      await expect(appPage.locator('#save-state')).toContainText('idle');

      const content = '# Work Session\n\nline two\nline three';
      await replaceEditorContents(appPage, content);
      await expect(appPage.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });
      await expect.poll(() => getEditorContents(appPage)).toBe(content);

      await expect
        .poll(() => previewText(appPage), { timeout: 5000 })
        .toContain('Work Session');
      await expect.poll(() => previewText(appPage)).toContain('line three');
      await expect(appPage.locator('footer')).toContainText('4 lines');

      await appPage.keyboard.press('Control+Shift+S');
      await saveViaFileSelector(appPage, savePath);
      await expect(appPage.locator('#save-state')).toContainText('saved', {
        timeout: 5000,
      });

      await expect
        .poll(() => (existsSync(savePath) ? readFileSync(savePath, 'utf-8') : null), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe(content);

      await openMenu(appPage, 'Plugin');
      await appPage.locator('[role="menuitem"]').filter({ hasText: 'Export' }).hover();

      const exportItem = appPage
        .locator('[role="menuitem"]')
        .filter({ hasText: 'Export to HTML' });
      if (await exportItem.isVisible()) {
        await exportItem.click();
        await expect(appPage.locator('#plugin-state')).toContainText('idle', {
          timeout: 10000,
        });
        await expect(appPage.locator('#save-state')).toContainText('saved', {
          timeout: 5000,
        });
        await expect(appPage.locator('#status')).toContainText(/ready|saved/, {
          timeout: 5000,
        });
      }

      await appPage.evaluate('window.location.reload()');
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('#status')).toContainText('ready', {
        timeout: 10000,
      });
      await expect
        .poll(() => previewText(appPage), { timeout: 5000 })
        .toContain('Work Session');
    },
  );

  workSessionTest(
    'real typing, undo, rapid edits, and final preview state behave as one editing session',
    async ({ appPage }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      await appPage.locator('.cm-content').click();
      await appPage.keyboard.type('# Typed Live\n\nKeystroke by keystroke.');
      await expect
        .poll(() => getEditorContents(appPage), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe('# Typed Live\n\nKeystroke by keystroke.');
      await expect
        .poll(() => previewText(appPage), { timeout: 5000 })
        .toContain('Typed Live');
      await expect
        .poll(() => previewText(appPage))
        .toContain('Keystroke by keystroke.');

      await appPage.keyboard.press('Control+A');
      await appPage.keyboard.insertText('original text');
      await expect
        .poll(() => getEditorContents(appPage), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe('original text');

      await appPage.keyboard.press('Control+Z');
      await expect
        .poll(() => getEditorContents(appPage), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe('# Typed Live\n\nKeystroke by keystroke.');

      for (let i = 1; i <= 8; i += 1) {
        const candidate = `# Rapid ${i}\n\nFinal candidate ${i}.`;
        await replaceEditorContents(appPage, candidate);
        await expect(appPage.locator('#save-state')).toContainText('unsaved', {
          timeout: 3000,
        });
      }
      await expect
        .poll(() => previewText(appPage), { timeout: 15000 })
        .toContain('Rapid 8');
      await expect.poll(() => previewText(appPage)).toContain('Final candidate 8.');

      const longDocument = Array.from(
        { length: 120 },
        (_value, index) => `Line ${index + 1}: content`,
      ).join('\n');
      await replaceEditorContents(appPage, longDocument);
      await expect.poll(() => getEditorContents(appPage)).toBe(longDocument);
      await expect(appPage.locator('footer')).toContainText('120 lines');

      const scroller = appPage.locator('#editor .cm-scroller');
      await scroller.evaluate('(el) => { el.scrollTop = 700; }');
      await expect
        .poll(() => scroller.evaluate('(el) => el.scrollTop'), {
          timeout: 3000,
          intervals: [100, 200],
        })
        .toBeGreaterThan(100);
    },
  );

  workspaceTest(
    'workspace file browsing, file identity, and save targets survive a realistic session',
    async ({ appPage, testEnv }) => {
      const dir = testEnv.workspaceDir;
      const original = path.join(dir, 'original.md');
      const chapter = path.join(dir, 'nested', 'chapter.md');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect
        .poll(() => previewText(appPage), { timeout: 5000 })
        .toContain('Original');
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        original,
      );

      await appPage.locator('button[aria-label="File Explorer"]').click();
      await expect(appPage.getByTestId('explorer-drawer')).toBeVisible({
        timeout: 5000,
      });

      const explorerDrawer = appPage.getByTestId('explorer-drawer');
      await expect(explorerDrawer).toContainText('chapter.md');
      await expect(explorerDrawer).toContainText('original.md');
      await expect(explorerDrawer).not.toContainText('notes.txt');
      await expect(explorerDrawer).not.toContainText('ignored.md');
      await expect(explorerDrawer).not.toContainText('image.png');

      await appPage
        .locator('button')
        .filter({ hasText: /nested/ })
        .click();
      await appPage
        .locator('button')
        .filter({ hasText: /chapter\.md/ })
        .click();

      const unsavedModal = appPage.locator('h2').filter({ hasText: 'Unsaved Changes' });
      if (await unsavedModal.isVisible()) {
        await appPage
          .locator('.fixed.inset-0')
          .locator('button')
          .filter({ hasText: 'Discard' })
          .click();
      }

      await expect
        .poll(() => previewText(appPage), { timeout: 5000 })
        .toContain('Initial chapter');
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        chapter,
      );

      await replaceEditorContents(
        appPage,
        '# Chapter Edited\n\nSaved through Explorer.',
      );
      await expect(appPage.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });

      await appPage
        .locator('button')
        .filter({ hasText: /original\.md/ })
        .click();
      if (await unsavedModal.isVisible()) {
        await appPage
          .locator('.fixed.inset-0')
          .locator('button')
          .filter({ hasText: 'Save' })
          .click();
      }

      await expect
        .poll(() => previewText(appPage), { timeout: 5000 })
        .toContain('Original');
      await expect
        .poll(() => readFileSync(chapter, 'utf-8'), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe('# Chapter Edited\n\nSaved through Explorer.');
      await expect(readFileSync(original, 'utf-8')).toBe(
        '# Original\n\nKeep this file unchanged.',
      );
    },
  );

  pasteEventTest(
    'pasting an image via paste event inserts figure markdown and saves the asset',
    async ({ appPage, testEnv }) => {
      const saveDir = testEnv.workspaceDir;
      const savePath = path.join(saveDir, 'doc.md');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect
        .poll(() => previewText(appPage), { timeout: 5000 })
        .toContain('Paste Test');

      // Create a tiny PNG and dispatch a paste event with it
      const pngBytes = await appPage.evaluate(`
        (() => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no canvas context');
          ctx.fillStyle = '#00ff00';
          ctx.fillRect(0, 0, 1, 1);
          return new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
              if (!b) { reject(new Error('canvas.toBlob failed')); return; }
              b.arrayBuffer().then(ab => resolve(Array.from(new Uint8Array(ab))));
            }, 'image/png');
          });
        })()
      `);

      // Dispatch the paste event via evaluate(string)
      await appPage.evaluate(`
        (() => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#00ff00';
          ctx.fillRect(0, 0, 1, 1);
          canvas.toBlob((blob) => {
            if (!blob) throw new Error('no blob');
            const file = new File([blob], 'pasted.png', { type: 'image/png' });
            const dt = new DataTransfer();
            dt.items.add(file);
            const event = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: dt,
            });
            document.dispatchEvent(event);
          }, 'image/png');
        })()
      `);

      await expect
        .poll(() => getEditorContents(appPage), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toMatch(/!\[\]\(\.\/figures\/figure-[\w-]+\.png\)/);

      const documentWithFigure = await getEditorContents(appPage);
      const figureMatch = documentWithFigure.match(
        /!\[\]\(\.\/(figures\/figure-[\w-]+\.png)\)/,
      );
      expect(figureMatch).not.toBeNull();
      const figurePath = path.join(saveDir, figureMatch![1]);

      // Wait for the file to be written to disk
      await expect
        .poll(() => existsSync(figurePath), { timeout: 5000, intervals: [100, 200] })
        .toBe(true);

      const expectedPng = Buffer.from(pngBytes as number[]);
      expect(readFileSync(figurePath)).toEqual(expectedPng);

      await expect
        .poll(() => previewInnerHTML(appPage), { timeout: 5000 })
        .toContain('<img');
    },
  );
});
