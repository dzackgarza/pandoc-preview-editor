import { test, expect } from '@playwright/test';
import { type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { editorState } from './editor-helpers.js';

// --- helpers ---

function previewFrame(page: Page) {
  return page.frameLocator('#preview');
}

async function openMenu(page: Page, name: string) {
  await page.getByRole('menuitem', { name }).click();
}

async function clickMenuItem(page: Page, name: string) {
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function typeIntoEditor(page: Page, text: string) {
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(50);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(800);
}

// --- fixture helpers ---

function setupDirWithFile(name: string, content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'pandoc-ux-'));
  writeFileSync(join(dir, name), content, 'utf-8');
  return dir;
}

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

// --- test suite ---

test.describe('user behaviors', () => {
  let server: ServerInstance;
  let pageErrors: Error[] = [];
  let consoleErrors: string[] = [];

  test.beforeAll(async () => {
    server = await launchServer();
  });

  test.afterAll(async () => {
    if (server) await killServer(server);
  });

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

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== 'passed') return;
    expect(
      pageErrors,
      `page errors: ${pageErrors.map((e) => e.message).join('; ')}`,
    ).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  // ── cold start ──

  test.describe('cold start', () => {
    test('loads with blank editor, preview, and idle save state', async ({ page }) => {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#preview')).toBeAttached();
      await expect(page.locator('#save-state')).toContainText('idle');
    });

    test('typing transitions to unsaved state', async ({ page }) => {
      await page.goto(server.url);
      await page.locator('#editor .cm-content').click();
      await page.keyboard.insertText('Hello');
      await expect(page.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });
    });

    test('Ctrl+S saves and transitions to saved state', async ({ page }) => {
      await page.goto(server.url);
      const content = '# Quick Save\n\nFrom cold start.';
      await typeIntoEditor(page, content);

      await page.locator('#editor .cm-content').click();
      await page.keyboard.press('Control+S');
      await expect(page.locator('#save-state')).toContainText('saved', {
        timeout: 5000,
      });

      const savedPath = (await editorState(page)).currentFile;
      expect(savedPath).toBeTruthy();
      await expect
        .poll(() => readFileSync(savedPath!, 'utf-8'), {
          timeout: 5000,
          intervals: [100],
        })
        .toBe(content);
    });
  });

  // ── typing ──

  test.describe('typing', () => {
    test('real keystrokes produce correct preview', async ({ page }) => {
      await page.goto(server.url);
      await page.locator('#editor .cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('# Typed Live\n\nKeystroke by keystroke.');
      await page.waitForTimeout(800);

      const frame = previewFrame(page);
      await expect(frame.locator('h1')).toContainText('Typed Live', { timeout: 5000 });
      await expect(frame.locator('body')).toContainText('Keystroke');
    });

    test('undo/redo works', async ({ page }) => {
      await page.goto(server.url);
      await page.locator('#editor .cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText('original text');
      await page.waitForTimeout(300);

      await page.keyboard.press('Control+Z');
      await page.waitForTimeout(200);

      const state = await editorState(page);
      expect(state.markdown.length).toBeLessThan('original text'.length);
    });

    test('burst typing does not produce errors', async ({ page }) => {
      await page.goto(server.url);
      await page.locator('#editor .cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');

      const chars = Array.from({ length: 200 }, (_, i) =>
        String.fromCharCode(97 + (i % 26)),
      );
      await page.keyboard.insertText(chars.join(''));
      await page.waitForTimeout(1500);

      const frame = previewFrame(page);
      await expect(frame.locator('body')).toBeAttached({ timeout: 5000 });
    });
  });

  // ── menus ──

  test.describe('menus', () => {
    test('File menu shows New, Open, Save', async ({ page }) => {
      await page.goto(server.url);
      await openMenu(page, 'File');
      await expect(page.getByRole('menuitem', { name: 'New' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Open' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Save' })).toBeVisible();
    });

    test('View menu shows Explorer and Reset Split', async ({ page }) => {
      await page.goto(server.url);
      await openMenu(page, 'View');
      await expect(page.getByRole('menuitem', { name: /Explorer/ })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Reset Split' })).toBeVisible();
    });

    test('Plugin menu runs export against current editor text', async ({ page }) => {
      const dir = setupDirWithFile('paper.md', '# Old Title\n\nBefore edit.');
      const source = join(dir, 'paper.md');
      const output = join(dir, 'paper.html');

      let srv: ServerInstance | undefined;
      try {
        srv = await launchServer(undefined, source);
        await page.goto(srv.url);

        const edited = '# Fresh Plugin Export\n\nSaved before command execution.';
        await typeIntoEditor(page, edited);

        await openMenu(page, 'Plugin');
        await page.getByRole('menuitem', { name: 'Export' }).hover();
        await clickMenuItem(page, 'Export to HTML');

        await expect(page.locator('#plugin-state')).toContainText('plugin complete', {
          timeout: 10000,
        });
        expect(readFileSync(source, 'utf-8')).toBe(edited);
        await expect
          .poll(() => (readFileSync(output, 'utf-8') || ''), {
            timeout: 10000,
            intervals: [200],
          })
          .toContain('Fresh Plugin Export');
      } finally {
        await page.close();
        if (srv) await killServer(srv);
        cleanupDir(dir);
      }
    });

    test('File → New creates blank document', async ({ page }) => {
      await page.goto(server.url);
      await typeIntoEditor(page, '# Old Content');
      await page.waitForTimeout(300);

      await openMenu(page, 'File');
      await clickMenuItem(page, 'New');

      await expect
        .poll(() => editorState(page).then((s) => s.markdown), { timeout: 5000 })
        .toBe('');
      const state = await editorState(page);
      expect(state.currentFile).toMatch(/untitled-/);
    });

    test('File → Open shows Explorer', async ({ page }) => {
      await page.goto(server.url);
      await openMenu(page, 'File');
      await clickMenuItem(page, 'Open');
      await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });
    });

    test('View toggles Explorer', async ({ page }) => {
      await page.goto(server.url);

      await openMenu(page, 'View');
      await clickMenuItem(page, 'Show Explorer');
      await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });

      await openMenu(page, 'View');
      await clickMenuItem(page, 'Hide Explorer');
      await expect(page.getByTestId('explorer-drawer')).not.toBeVisible({
        timeout: 3000,
      });
    });

    test('toolbar buttons toggle Explorer and Save', async ({ page }) => {
      await page.goto(server.url);

      await page.getByRole('button', { name: 'Toggle Explorer' }).click();
      await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });
      await page.getByRole('button', { name: 'Toggle Explorer' }).click();
      await expect(page.getByTestId('explorer-drawer')).not.toBeVisible({
        timeout: 3000,
      });

      const content = '# Toolbar Save';
      await typeIntoEditor(page, content);
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('#save-state')).toContainText('saved', {
        timeout: 5000,
      });

      const savedPath = (await editorState(page)).currentFile;
      expect(savedPath).toBeTruthy();
      await expect
        .poll(() => readFileSync(savedPath!, 'utf-8'), {
          timeout: 5000,
          intervals: [100],
        })
        .toBe(content);
    });

    test('menu File → Save works same as Ctrl+S', async ({ page }) => {
      await page.goto(server.url);
      const content = '# Menu Save';
      await typeIntoEditor(page, content);

      await openMenu(page, 'File');
      await clickMenuItem(page, 'Save');
      await expect(page.locator('#save-state')).toContainText('saved', {
        timeout: 5000,
      });

      const savedPath = (await editorState(page)).currentFile;
      expect(savedPath).toBeTruthy();
      await expect
        .poll(() => readFileSync(savedPath!, 'utf-8'), {
          timeout: 5000,
          intervals: [100],
        })
        .toBe(content);
    });
  });

  // ── explorer ──

  test.describe('explorer', () => {
    test('navigates nested directories and opens a file', async ({ page }) => {
      const dir = setupDirWithFile('readme.md', '# README\n\nTop.');
      const subDir = join(dir, 'sub');
      mkdirSync(subDir);
      writeFileSync(join(subDir, 'chap.md'), '# Chapter\n\nFirst.', 'utf-8');

      let srv: ServerInstance | undefined;
      try {
        srv = await launchServer(undefined, join(dir, 'readme.md'));
        await page.goto(srv.url);

        await page.getByRole('button', { name: 'Toggle Explorer' }).click();
        await expect(page.getByTestId('explorer-drawer')).toBeVisible({
          timeout: 5000,
        });

        await page.getByRole('button', { name: /sub/ }).click();
        await page.getByRole('button', { name: /chap\.md/ }).click();

        await expect
          .poll(() => editorState(page).then((s) => s.markdown), { timeout: 5000 })
          .toBe('# Chapter\n\nFirst.');
      } finally {
        await page.close();
        if (srv) await killServer(srv);
        cleanupDir(dir);
      }
    });

    test('collapses directory on second click', async ({ page }) => {
      const dir = setupDirWithFile('readme.md', '# R.');
      const subDir = join(dir, 'sub');
      mkdirSync(subDir);
      writeFileSync(join(subDir, 'chap.md'), '# C.', 'utf-8');

      let srv: ServerInstance | undefined;
      try {
        srv = await launchServer(undefined, join(dir, 'readme.md'));
        await page.goto(srv.url);

        await page.getByRole('button', { name: 'Toggle Explorer' }).click();
        await page.getByRole('button', { name: /sub/ }).click();
        await expect(page.getByRole('button', { name: /chap\.md/ })).toBeVisible({
          timeout: 3000,
        });

        await page.getByRole('button', { name: /sub/ }).click();
        await expect(page.getByRole('button', { name: /chap\.md/ })).not.toBeVisible({
          timeout: 3000,
        });
      } finally {
        await page.close();
        if (srv) await killServer(srv);
        cleanupDir(dir);
      }
    });

    test('opening a file replaces editor content', async ({ page }) => {
      const dir = setupDirWithFile('a.md', '# A.');
      writeFileSync(join(dir, 'b.md'), '# B.', 'utf-8');

      let srv: ServerInstance | undefined;
      try {
        srv = await launchServer(undefined, join(dir, 'a.md'));
        await page.goto(srv.url);

        await page.getByRole('button', { name: 'Toggle Explorer' }).click();
        await page.getByRole('button', { name: /b\.md/ }).click();

        await expect
          .poll(() => editorState(page).then((s) => s.markdown), { timeout: 5000 })
          .toBe('# B.');
      } finally {
        await page.close();
        if (srv) await killServer(srv);
        cleanupDir(dir);
      }
    });

    test('opening another file leaves first unchanged on disk', async ({ page }) => {
      const dir = setupDirWithFile('readme.md', '# README\n\nOriginal.');
      const notes = join(dir, 'notes.txt');
      writeFileSync(notes, 'Notes text.', 'utf-8');
      const readme = join(dir, 'readme.md');

      let srv: ServerInstance | undefined;
      try {
        srv = await launchServer(undefined, readme);
        await page.goto(srv.url);

        await page.getByRole('button', { name: 'Toggle Explorer' }).click();

        const edited = '# Modified\n\nChanged.';
        await typeIntoEditor(page, edited);
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.locator('#save-state')).toContainText('saved', {
          timeout: 5000,
        });

        await page.getByRole('button', { name: /notes\.txt/ }).click();
        await expect
          .poll(() => editorState(page).then((s) => s.markdown), { timeout: 5000 })
          .toBe('Notes text.');

        expect(readFileSync(readme, 'utf-8')).toBe(edited);
        expect(readFileSync(notes, 'utf-8')).toBe('Notes text.');
      } finally {
        await page.close();
        if (srv) await killServer(srv);
        cleanupDir(dir);
      }
    });
  });

  // ── status bar ──

  test.describe('status bar', () => {
    test('status shows ready after render', async ({ page }) => {
      await page.goto(server.url);
      await typeIntoEditor(page, '# Status Check');
      await expect(page.locator('#status')).toContainText('ready', { timeout: 5000 });
    });

    test('save state transitions: idle → unsaved → saved', async ({ page }) => {
      await page.goto(server.url);
      await expect(page.locator('#save-state')).toContainText('idle');

      await page.locator('#editor .cm-content').click();
      await page.keyboard.insertText('new content');
      await page.waitForTimeout(200);
      await expect(page.locator('#save-state')).toContainText('unsaved', {
        timeout: 3000,
      });

      await page.locator('#editor .cm-content').click();
      await page.keyboard.press('Control+S');
      await expect(page.locator('#save-state')).toContainText('saved', {
        timeout: 5000,
      });
    });

    test('duration shows ms', async ({ page }) => {
      await page.goto(server.url);
      await typeIntoEditor(page, '# Duration');
      await page.waitForTimeout(500);

      await expect(page.locator('#duration')).toContainText('ms', { timeout: 5000 });
      const text = await page.locator('#duration').innerText();
      expect(text).toMatch(/\d+ms/);
    });

    test('line count updates', async ({ page }) => {
      await page.goto(server.url);
      await page.locator('#editor .cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText('line one\nline two\nline three');
      await page.waitForTimeout(300);

      await expect(page.locator('footer')).toContainText('3 lines');
    });
  });

  // ── panel resizing ──

  test.describe('panel resizing', () => {
    test('drag separator resizes panels', async ({ page }) => {
      await page.goto(server.url);

      const separator = page.locator('#editor-preview-separator');
      await expect(separator).toBeVisible({ timeout: 5000 });

      const editorPane = page.locator('[data-testid="editor"]');
      const initialBox = await editorPane.boundingBox();
      if (!initialBox) throw new Error('editor not found');

      const sepBox = await separator.boundingBox();
      if (!sepBox) throw new Error('separator not found');

      await page.mouse.move(sepBox.x + sepBox.width / 2, sepBox.y + sepBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        sepBox.x + sepBox.width / 2 + 100,
        sepBox.y + sepBox.height / 2,
        { steps: 10 },
      );
      await page.mouse.up();
      await page.waitForTimeout(300);

      const afterBox = await editorPane.boundingBox();
      if (!afterBox) throw new Error('editor not found after drag');
      expect(afterBox.width).toBeGreaterThan(initialBox.width + 50);
    });

    test('View → Reset Split restores defaults', async ({ page }) => {
      await page.goto(server.url);

      const separator = page.locator('#editor-preview-separator');
      const sepBox = await separator.boundingBox();
      if (!sepBox) throw new Error('separator not found');

      await page.mouse.move(sepBox.x + sepBox.width / 2, sepBox.y + sepBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        sepBox.x + sepBox.width / 2 + 200,
        sepBox.y + sepBox.height / 2,
        { steps: 10 },
      );
      await page.mouse.up();
      await page.waitForTimeout(300);

      const afterDrag = await page.locator('[data-testid="editor"]').boundingBox();
      if (!afterDrag) throw new Error('editor not found');

      await openMenu(page, 'View');
      await clickMenuItem(page, 'Reset Split');
      await page.waitForTimeout(300);

      const resetBox = await page.locator('[data-testid="editor"]').boundingBox();
      if (!resetBox) throw new Error('editor not found after reset');
      expect(resetBox.width).toBeLessThan(afterDrag.width);
    });
  });

  // ── scroll ──

  test.describe('scroll', () => {
    test('editor scrolls with long content', async ({ page }) => {
      await page.goto(server.url);
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: content`);
      await typeIntoEditor(page, lines.join('\n'));
      await page.waitForTimeout(1500);

      const cmScroller = page.locator('#editor .cm-scroller');
      await cmScroller.evaluate((el) => {
        el.scrollTop = 500;
      });
      await page.waitForTimeout(200);

      const scrollTop = await cmScroller.evaluate((el) => el.scrollTop);
      expect(scrollTop).toBeGreaterThan(100);
    });
  });

  // ── file path survives reload ──

  test('file path persists across page reload', async ({ page }) => {
    await page.goto(server.url);
    await page.waitForTimeout(500);

    const stateBefore = await editorState(page);
    expect(stateBefore.currentFile).toBeTruthy();

    await page.reload();
    await page.waitForTimeout(1000);

    const stateAfter = await editorState(page);
    expect(stateAfter.currentFile).toBe(stateBefore.currentFile);
  });

  // ── full document editing ──

  test('full document with all markdown features renders without errors', async ({
    page,
  }) => {
    await page.goto(server.url);

    const doc = [
      '# Typed Document',
      '',
      'Paragraph with **bold**, *italic*, and `code`.',
      '',
      '## Section',
      '',
      '- one',
      '- two',
      '- three',
      '',
      '> Blockquote with **bold** inside.',
      '',
      '```javascript',
      'const x = 42;',
      'console.log(x);',
      '```',
      '',
      '$\\int_0^\\infty e^{-x} dx = 1$',
      '',
      '[Link](https://example.com)',
    ].join('\n');

    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(doc);
    await page.waitForTimeout(2000);

    const frame = previewFrame(page);

    await expect(frame.locator('h1')).toContainText('Typed Document', {
      timeout: 5000,
    });
    await expect(frame.locator('h2')).toContainText('Section', { timeout: 5000 });
    await expect(frame.locator('pre code').first()).toContainText('const x = 42', {
      timeout: 5000,
    });
    await expect(frame.locator('li')).toHaveCount(3, { timeout: 5000 });
    await expect(frame.locator('blockquote')).toBeAttached({ timeout: 5000 });
    await expect(frame.locator('mjx-container')).toBeAttached({ timeout: 10000 });
    await expect(frame.locator('a[href="https://example.com"]')).toContainText('Link', {
      timeout: 5000,
    });
    await expect(page.locator('#status')).toContainText('ready', { timeout: 5000 });
  });

  // ── complex content stress ──

  test.describe('complex content stress', () => {
    test('document with tables, code, math, lists, blockquotes renders cleanly', async ({
      page,
    }) => {
      await page.goto(server.url);

      const doc = [
        '# Complex Document',
        '',
        '| H1 | H2 | H3 |',
        '|---|---|---|',
        '| a | b | c |',
        '| d | e | f |',
        '',
        '```python',
        'def fib(n):',
        '    if n <= 1: return n',
        '    return fib(n-1) + fib(n-2)',
        '```',
        '',
        '$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$',
        '',
        '$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$',
        '',
        '- Nested',
        '  - Sub **bold**',
        '    - Deep *italic* `code`',
        '- Top',
        '',
        '> Blockquote **bold** *italic*',
        '>> Nested quote',
        '',
        '---',
        '',
        '## References',
        '',
        '[a](https://a.com) [b](https://b.com)',
        '',
        '```javascript',
        'export const x = 42;',
        '```',
      ].join('\n');

      await page.locator('#editor .cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(doc);
      await page.waitForTimeout(3000);

      const frame = previewFrame(page);

      await expect(frame.locator('table')).toBeAttached({ timeout: 5000 });
      await expect(frame.locator('th').first()).toContainText('H1');
      await expect(frame.locator('mjx-container').first()).toBeAttached({
        timeout: 20000,
      });
      await expect(frame.locator('blockquote')).toBeAttached({ timeout: 5000 });
      await expect(frame.locator('a[href="https://a.com"]')).toBeAttached({
        timeout: 5000,
      });
      await expect(page.locator('#status')).toContainText('ready', { timeout: 5000 });
      await expect(page.locator('#status')).not.toContainText('error');
    });

    test('rapid save-edit cycles do not error', async ({ page }) => {
      await page.goto(server.url);

      for (let i = 0; i < 5; i++) {
        await typeIntoEditor(page, `# Cycle ${i}\n\nEdit ${i}.`);
        await page.locator('#editor .cm-content').click();
        await page.keyboard.press('Control+S');
        await page.waitForTimeout(300);
      }

      await expect(page.locator('#save-state')).toContainText('saved', {
        timeout: 5000,
      });
      await expect(page.locator('#status')).not.toContainText('error');
    });

    test('syntax errors render as error, not crash', async ({ page }) => {
      await page.goto(server.url);

      await page.locator('#editor .cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText('```unclosed_code_fence\njust text');
      await page.waitForTimeout(1000);

      await expect(page.locator('#status')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#editor')).toBeVisible();
    });
  });
});
