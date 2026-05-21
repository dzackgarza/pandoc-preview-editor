import { expect, test, type Page } from '@playwright/test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  editorState,
  expectEditorMarkdown,
  setEditorMarkdown,
} from './editor-helpers.js';
import { killServer, launchServer } from './helpers.js';

function previewFrame(page: Page) {
  return page.frameLocator('#preview');
}

async function openMenu(page: Page, name: string) {
  await page.getByRole('menuitem', { name }).click();
}

async function clickMenuItem(page: Page, name: string) {
  await page.getByRole('menuitem', { name, exact: true }).click();
}

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

async function fillSaveAsDialog(page: Page, filename: string) {
  const input = page.locator('.fixed.inset-0 input');
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.fill(filename);
  // Click the Save/Create button (the one that's not Cancel)
  await page.locator('.fixed.inset-0 button:not([disabled])').last().click();
}

test.describe('user workflows', () => {
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
    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('default document editing, saving, reload, status, and layout controls work together', async ({
    page,
  }) => {
    const server = await launchServer();
    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#preview')).toBeAttached();
      await expect(page.locator('#save-state')).toContainText('idle');

      const content = '# Work Session\n\nline two\nline three';
      await setEditorMarkdown(page, content);
      expect((await editorState(page)).markdown).toBe(content);
      await expect(page.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });
      await expect(previewFrame(page).locator('h1')).toHaveText('Work Session', {
        timeout: 5000,
      });
      await expect(previewFrame(page).locator('body')).toContainText('line three');
      await expect(page.locator('footer')).toContainText('4 lines');

      await page.getByRole('button', { name: 'Save' }).click();
      // Save As dialog appears because this is a temp file
      await fillSaveAsDialog(page, 'work-session.md');
      await expect(page.locator('#save-state')).toContainText('saved', {
        timeout: 5000,
      });
      await expect(page.locator('#status')).toContainText(/ready|saved/, {
        timeout: 5000,
      });
      await expect(page.locator('#duration')).toContainText(/\d+ms/, {
        timeout: 5000,
      });
      await expect(page.locator('footer')).toContainText('4 lines');
      await expect(page.locator('[data-testid="saved-timestamp"]')).toBeVisible({
        timeout: 3000,
      });

      const savedPath = (await editorState(page)).currentFile;
      expect(savedPath).toMatch(/work-session\.md$/);
      await expect
        .poll(() => readFileSync(savedPath!, 'utf-8'), {
          timeout: 5000,
          intervals: [100],
        })
        .toBe(content);

      await page.reload();
      await expectEditorMarkdown(page, content);
      expect((await editorState(page)).currentFile).toBe(savedPath);
      await expect(previewFrame(page).locator('h1')).toHaveText('Work Session', {
        timeout: 5000,
      });

      const separator = page.locator('#editor-preview-separator');
      const before = await page.locator('[data-testid="editor"]').boundingBox();
      const separatorBox = await separator.boundingBox();
      if (!before || !separatorBox) throw new Error('split layout was not measurable');

      await page.mouse.move(
        separatorBox.x + separatorBox.width / 2,
        separatorBox.y + separatorBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        separatorBox.x + separatorBox.width / 2 + 160,
        separatorBox.y + separatorBox.height / 2,
        { steps: 10 },
      );
      await page.mouse.up();

      const resized = await page.locator('[data-testid="editor"]').boundingBox();
      if (!resized) throw new Error('editor pane disappeared after resize');
      expect(resized.width).toBeGreaterThan(before.width + 80);

      await openMenu(page, 'View');
      await clickMenuItem(page, 'Reset Split');
      const reset = await page.locator('[data-testid="editor"]').boundingBox();
      if (!reset) throw new Error('editor pane disappeared after reset');
      expect(reset.width).toBeLessThan(resized.width);
    } finally {
      await killServer(server);
    }
  });

  test('real typing, undo, rapid edits, and final preview state behave as one editing session', async ({
    page,
  }) => {
    const server = await launchServer();
    try {
      await page.goto(server.url);
      await page.locator('#editor .cm-content').click();
      await page.keyboard.type('# Typed Live\n\nKeystroke by keystroke.');
      await expect
        .poll(() => editorState(page).then((state) => state.markdown), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe('# Typed Live\n\nKeystroke by keystroke.');
      await expect(previewFrame(page).locator('h1')).toHaveText('Typed Live', {
        timeout: 5000,
      });
      await expect(previewFrame(page).locator('body')).toContainText(
        'Keystroke by keystroke.',
      );

      await page.keyboard.press('Control+A');
      await page.keyboard.insertText('original text');
      await expect
        .poll(() => editorState(page).then((state) => state.markdown), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe('original text');
      await page.keyboard.press('Control+Z');
      await expect
        .poll(() => editorState(page).then((state) => state.markdown), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe('# Typed Live\n\nKeystroke by keystroke.');

      for (let i = 1; i <= 8; i += 1) {
        const candidate = `# Rapid ${i}\n\nFinal candidate ${i}.`;
        await setEditorMarkdown(page, candidate);
        expect((await editorState(page)).markdown).toBe(candidate);
        await expect(page.locator('#save-state')).toContainText('unsaved', {
          timeout: 3000,
        });
      }
      await expect(previewFrame(page).locator('h1')).toHaveText('Rapid 8', {
        timeout: 5000,
      });
      await expect(previewFrame(page).locator('body')).toContainText(
        'Final candidate 8.',
      );

      const longDocument = Array.from(
        { length: 120 },
        (_value, index) => `Line ${index + 1}: content`,
      ).join('\n');
      await setEditorMarkdown(page, longDocument);
      expect((await editorState(page)).markdown).toBe(longDocument);
      await expect(page.locator('footer')).toContainText('120 lines');
      const scroller = page.locator('#editor .cm-scroller');
      await scroller.evaluate((el) => {
        el.scrollTop = 700;
      });
      await expect
        .poll(() => scroller.evaluate((el) => el.scrollTop), {
          timeout: 3000,
          intervals: [100, 200],
        })
        .toBeGreaterThan(100);
    } finally {
      await killServer(server);
    }
  });

  test('workspace file browsing, file identity, and save targets survive a realistic session', async ({
    page,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'pandoc-workflow-'));
    const original = join(dir, 'original.md');
    const notes = join(dir, 'notes.txt');
    const nested = join(dir, 'nested');
    const chapter = join(nested, 'chapter.md');
    mkdirSync(nested);
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(original, '# Original\n\nKeep this file unchanged.', 'utf-8');
    writeFileSync(notes, 'Notes text.', 'utf-8');
    writeFileSync(chapter, '# Chapter\n\nInitial chapter.', 'utf-8');
    writeFileSync(join(dir, 'node_modules', 'ignored.md'), '# Ignored', 'utf-8');
    writeFileSync(join(dir, 'image.png'), Buffer.from([0, 1, 2, 3]));

    const server = await launchServer(undefined, original);
    try {
      await page.goto(server.url);
      await expectEditorMarkdown(page, '# Original\n\nKeep this file unchanged.');
      expect((await editorState(page)).currentFile).toBe(original);
      await expect(previewFrame(page).locator('h1')).toHaveText('Original', {
        timeout: 5000,
      });

      await openMenu(page, 'File');
      await clickMenuItem(page, 'Open');
      await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('button', { name: /original\.md/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /nested/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /notes\.txt/ })).toBeVisible();
      await expect(page.getByText('ignored.md')).toHaveCount(0);
      await expect(page.getByText('image.png')).toHaveCount(0);

      await page.getByRole('button', { name: /nested/ }).click();
      await expect(page.getByRole('button', { name: /chapter\.md/ })).toBeVisible();
      await page.getByRole('button', { name: /chapter\.md/ }).click();
      await expectEditorMarkdown(page, '# Chapter\n\nInitial chapter.');
      expect((await editorState(page)).currentFile).toBe(chapter);
      await expect(previewFrame(page).locator('h1')).toHaveText('Chapter', {
        timeout: 5000,
      });

      const editedChapter = '# Chapter Edited\n\nSaved through Explorer.';
      await setEditorMarkdown(page, editedChapter);
      await expect(page.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });
      await openMenu(page, 'File');
      await clickMenuItem(page, 'Save');
      await expect(page.locator('#save-state')).toContainText('saved', {
        timeout: 5000,
      });
      await expect
        .poll(() => readFileSync(chapter, 'utf-8'), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe(editedChapter);
      expect(readFileSync(original, 'utf-8')).toBe(
        '# Original\n\nKeep this file unchanged.',
      );

      await page.getByRole('button', { name: /notes\.txt/ }).click();
      await expectEditorMarkdown(page, 'Notes text.');
      expect((await editorState(page)).currentFile).toBe(notes);
      expect(readFileSync(chapter, 'utf-8')).toBe(editedChapter);

      await openMenu(page, 'File');
      await clickMenuItem(page, 'New');
      // New File dialog appears
      await fillSaveAsDialog(page, 'untitled-new.md');
      // After creation, the file is empty and saved to disk
      await expect(page.locator('#save-state')).toContainText(/saved|idle/, {
        timeout: 5000,
      });
      await expectEditorMarkdown(page, '');
      expect((await editorState(page)).currentFile).toMatch(/untitled-new\.md$/);
      const createdContent = '# New Document\n\nCreated from File menu.';
      await setEditorMarkdown(page, createdContent);
      await expect(previewFrame(page).locator('h1')).toHaveText('New Document', {
        timeout: 5000,
      });
      await openMenu(page, 'File');
      await clickMenuItem(page, 'Save');
      await expect
        .poll(
          () => {
            const createdName = readdirSync(dir).find((name) =>
              /^untitled-new\.md$/.test(name),
            );
            return createdName ? readFileSync(join(dir, createdName), 'utf-8') : null;
          },
          { timeout: 5000, intervals: [100, 200] },
        )
        .toBe(createdContent);

      const currentFile = (await editorState(page)).currentFile;
      expect(currentFile).toMatch(/untitled-new\.md$/);
      expect(readFileSync(currentFile!, 'utf-8')).toBe(createdContent);
      expect(readFileSync(original, 'utf-8')).toBe(
        '# Original\n\nKeep this file unchanged.',
      );
      expect(readFileSync(chapter, 'utf-8')).toBe(editedChapter);
      expect(readFileSync(notes, 'utf-8')).toBe('Notes text.');
    } finally {
      await page.close();
      await killServer(server);
      cleanupDir(dir);
    }
  });
});
