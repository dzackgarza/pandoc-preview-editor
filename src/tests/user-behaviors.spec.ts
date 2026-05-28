import { expect, test, type Page } from '@playwright/test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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

async function writePngToClipboard(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  const pngBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas context was not available');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 1, 1);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error('canvas did not produce a PNG blob'));
      }, 'image/png');
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    const [clipboardItem] = await navigator.clipboard.read();
    const imageType = clipboardItem.types.find(
      (type) => type === 'image/png' || type.startsWith('image/'),
    );
    if (!imageType) throw new Error('clipboard did not contain an image');
    const clipboardBlob = await clipboardItem.getType(imageType);
    return Array.from(new Uint8Array(await clipboardBlob.arrayBuffer()));
  });
  return Buffer.from(pngBytes);
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
        const location = msg.location();
        const source = location.url ? ` ${location.url}:${location.lineNumber}` : '';
        consoleErrors.push(`[${msg.type()}]${source} ${msg.text()}`);
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
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-save-as-'));
    const savePath = join(saveDir, 'work-session.md');
    const server = await launchServer();
    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#preview')).toBeAttached();
      await expect(page.locator('#save-state')).toContainText('idle');
      expect((await editorState(page)).currentFile).toBeNull();
      const backupPath = await page.evaluate(() => window.__TEMP_BACKUP_FILE);
      expect(backupPath).toMatch(/\/pandoc-preview\/untitled-[\w-]+\.md$/);

      const content = '# Work Session\n\nline two\nline three';
      await setEditorMarkdown(page, content);
      expect((await editorState(page)).markdown).toBe(content);
      expect((await editorState(page)).currentFile).toBeNull();
      await expect
        .poll(() => (existsSync(backupPath!) ? readFileSync(backupPath!, 'utf-8') : null), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe(content);
      await expect(page.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });
      await expect(previewFrame(page).locator('h1')).toHaveText('Work Session', {
        timeout: 5000,
      });
      await expect(previewFrame(page).locator('body')).toContainText('line three');
      await expect(page.locator('footer')).toContainText('4 lines');

      const clipboardPng = await writePngToClipboard(page);
      await page.getByRole('button', { name: 'Insert Figure from Clipboard' }).click();
      await fillSaveAsDialog(page, savePath);
      await expect
        .poll(() => editorState(page).then((state) => state.markdown), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toMatch(/!\[\]\(\.\/figures\/figure-[\w-]+\.png\)/);
      const documentWithFigure = (await editorState(page)).markdown;
      const figureMatch = documentWithFigure.match(/!\[\]\(\.\/(figures\/figure-[\w-]+\.png)\)/);
      expect(figureMatch).not.toBeNull();
      const figurePath = join(saveDir, figureMatch![1]);
      expect(readFileSync(figurePath)).toEqual(clipboardPng);
      expect(readFileSync(savePath, 'utf-8')).toBe(content);
      await expect(previewFrame(page).locator('img')).toHaveJSProperty(
        'naturalWidth',
        1,
      );
      await expect(page.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });
      await expect(page.locator('footer')).toContainText('8 lines');

      await openMenu(page, 'Plugin');
      await page.getByRole('menuitem', { name: 'Export' }).hover();
      await clickMenuItem(page, 'Export to HTML');
      await expect(page.locator('#plugin-state')).toContainText('plugin complete', {
        timeout: 10000,
      });
      await expect(page.locator('#save-state')).toContainText('saved', {
        timeout: 5000,
      });
      await expect(page.locator('#status')).toContainText(/ready|saved/, {
        timeout: 5000,
      });
      await expect(page.locator('#duration')).toContainText(/\d+ms/, {
        timeout: 5000,
      });
      await expect(page.locator('footer')).toContainText('8 lines');
      await expect(page.locator('[data-testid="saved-timestamp"]')).toBeVisible({
        timeout: 3000,
      });

      const savedPath = (await editorState(page)).currentFile;
      expect(savedPath).toBe(savePath);
      await expect
        .poll(() => readFileSync(savedPath!, 'utf-8'), {
          timeout: 5000,
          intervals: [100],
        })
        .toBe(documentWithFigure);
      expect(existsSync(join(saveDir, 'work-session.html'))).toBe(true);

      await page.reload();
      await expectEditorMarkdown(page, documentWithFigure);
      expect((await editorState(page)).currentFile).toBe(savedPath);
      await expect
        .poll(() => page.evaluate(() => window.__WORKSPACE_ROOT), {
          timeout: 3000,
          intervals: [100, 200],
        })
        .toBe(saveDir);
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
      cleanupDir(saveDir);
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
        timeout: 15000,
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
    const externalDir = mkdtempSync(join(tmpdir(), 'pandoc-new-target-'));
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

      await page.keyboard.press('Control+P');
      await expect(page.getByTestId('quick-open-dialog')).toBeVisible({
        timeout: 5000,
      });
      await expect(page.getByTestId('quick-open-result')).toContainText([
        'nested/chapter.md',
        'original.md',
      ]);
      await expect(page.getByTestId('quick-open-dialog')).not.toContainText(
        'notes.txt',
      );
      await expect(page.getByTestId('quick-open-dialog')).not.toContainText(
        'ignored.md',
      );
      await expect(page.getByTestId('quick-open-dialog')).not.toContainText(
        'image.png',
      );

      await page.getByLabel('Search files').fill('chapter');
      await expect(page.getByTestId('quick-open-result')).toHaveCount(1);
      await expect(page.getByTestId('quick-open-result').first()).toContainText(
        'nested/chapter.md',
      );
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('quick-open-dialog')).toHaveCount(0);
      await expectEditorMarkdown(page, '# Chapter\n\nInitial chapter.');
      expect((await editorState(page)).currentFile).toBe(chapter);

      await page.keyboard.press('Control+P');
      await expect(page.getByText('Recent')).toBeVisible();
      await expect(page.getByTestId('quick-open-result').first()).toContainText(
        'nested/chapter.md',
      );
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('quick-open-dialog')).toHaveCount(0);

      await openMenu(page, 'File');
      await clickMenuItem(page, 'Open');
      await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('button', { name: /original\.md/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /nested/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /notes\.txt/ })).toBeVisible();
      await expect(page.getByText('ignored.md')).toHaveCount(0);
      await expect(page.getByText('image.png')).toHaveCount(0);

      const editedChapter = '# Chapter Edited\n\nSaved through Explorer.';
      await setEditorMarkdown(page, editedChapter);
      await expect(page.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });
      await page.getByRole('button', { name: /notes\.txt/ }).click();
      await expectEditorMarkdown(page, 'Notes text.');
      expect((await editorState(page)).currentFile).toBe(notes);
      await expect
        .poll(() => readFileSync(chapter, 'utf-8'), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe(editedChapter);
      expect(readFileSync(original, 'utf-8')).toBe(
        '# Original\n\nKeep this file unchanged.',
      );

      const editedNotes = 'Notes text.\n\nSaved before New.';
      await setEditorMarkdown(page, editedNotes);
      await expect(page.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });

      await openMenu(page, 'File');
      await clickMenuItem(page, 'New');
      await expect
        .poll(() => readFileSync(notes, 'utf-8'), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe(editedNotes);
      const newPath = join(externalDir, 'new-document.md');
      await fillSaveAsDialog(page, newPath);
      await expect(page.locator('#save-state')).toContainText('unsaved', {
        timeout: 5000,
      });
      await expectEditorMarkdown(page, '');
      expect((await editorState(page)).currentFile).toBe(newPath);
      expect(existsSync(newPath)).toBe(false);
      const createdContent = '# New Document\n\nCreated from File menu.';
      await setEditorMarkdown(page, createdContent);
      await expect(previewFrame(page).locator('h1')).toHaveText('New Document', {
        timeout: 5000,
      });
      await openMenu(page, 'File');
      await clickMenuItem(page, 'Save');
      await expect
        .poll(() => (existsSync(newPath) ? readFileSync(newPath, 'utf-8') : null), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toBe(createdContent);

      const currentFile = (await editorState(page)).currentFile;
      expect(currentFile).toBe(newPath);
      expect(readFileSync(currentFile!, 'utf-8')).toBe(createdContent);
      await page.reload();
      await expectEditorMarkdown(page, createdContent);
      expect((await editorState(page)).currentFile).toBe(newPath);
      await expect
        .poll(() => page.evaluate(() => window.__WORKSPACE_ROOT), {
          timeout: 3000,
          intervals: [100, 200],
        })
        .toBe(externalDir);
      expect(readFileSync(original, 'utf-8')).toBe(
        '# Original\n\nKeep this file unchanged.',
      );
      expect(readFileSync(chapter, 'utf-8')).toBe(editedChapter);
      expect(readFileSync(notes, 'utf-8')).toBe(editedNotes);
    } finally {
      await page.close();
      await killServer(server);
      cleanupDir(dir);
      cleanupDir(externalDir);
    }
  });

  test('pasting an image via paste event (Wayland path) inserts figure markdown', async ({
    page,
  }) => {
    // On Wayland, navigator.clipboard.read() is broken for binary image types.
    // The correct code path is the paste DOM event, which always fires with
    // ClipboardEvent.clipboardData populated — even on Wayland.
    // This test proves that code path: it dispatches a synthetic paste event
    // carrying a 1x1 PNG and expects the figure to appear in the editor without
    // ever calling navigator.clipboard.read().
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-paste-event-'));
    const savePath = join(saveDir, 'doc.md');
    writeFileSync(savePath, '# Paste Test\n', 'utf-8');
    const server = await launchServer(undefined, savePath);
    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
      await expectEditorMarkdown(page, '# Paste Test\n');
      expect((await editorState(page)).currentFile).toBe(savePath);

      // Dispatch a synthetic paste event with a 1x1 PNG in clipboardData.
      // This is the event the browser fires on Ctrl+V, with image data available
      // through clipboardData — NOT through navigator.clipboard.read().
      const pngBytes: number[] = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas context');
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(0, 0, 1, 1);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('canvas.toBlob failed'));
          }, 'image/png');
        });
        const file = new File([blob], 'pasted.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const event = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });
        document.dispatchEvent(event);
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      });
      const expectedPng = Buffer.from(pngBytes);

      await expect
        .poll(() => editorState(page).then((s) => s.markdown), {
          timeout: 5000,
          intervals: [100, 200],
        })
        .toMatch(/!\[\]\(\.\/figures\/figure-[\w-]+\.png\)/);

      const documentWithFigure = (await editorState(page)).markdown;
      const figureMatch = documentWithFigure.match(
        /!\[\]\(\.\/(figures\/figure-[\w-]+\.png)\)/,
      );
      expect(figureMatch).not.toBeNull();
      const figurePath = join(saveDir, figureMatch![1]);
      expect(readFileSync(figurePath)).toEqual(expectedPng);
    } finally {
      await killServer(server);
      cleanupDir(saveDir);
    }
  });
});
