import { test, expect } from '@playwright/test';
import {
  mkdirSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import {
  editorState,
  expectEditorMarkdown,
  pressSave,
  setEditorMarkdown,
} from './editor-helpers.js';

/**
 * Write a temp markdown file, launch the server with it, then clean up.
 * Returns the temp dir path so tests can construct the file path.
 */
function withTempFile(content: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pandoc-test-'));
  const path = join(dir, 'test.md');
  writeFileSync(path, content, 'utf-8');
  return { dir, path };
}

function cleanTemp(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

test.describe('file loading and saving', () => {
  let server: ServerInstance;
  let tempCtx: { dir: string; path: string };

  test('CLI file argument loads content into CodeMirror and preview', async ({ page }) => {
    const content = '# Loaded File\n\nThis content comes from disk.';
    tempCtx = withTempFile(content);
    server = await launchServer(undefined, tempCtx.path);

    await page.goto(server.url);

    await expectEditorMarkdown(page, content);

    const frame = page.frameLocator('#preview');
    await expect(frame.locator('h1')).toContainText('Loaded File', { timeout: 5000 });
  });

  test('Ctrl+S saves CodeMirror content to disk', async ({ page }) => {
    tempCtx = withTempFile('# Original\n');
    server = await launchServer(undefined, tempCtx.path);

    await page.goto(server.url);

    const newContent = '# Modified\n\nNew content.';
    await setEditorMarkdown(page, newContent);
    await pressSave(page);

    await expect
      .poll(() => readFileSync(tempCtx.path, 'utf-8'), {
        timeout: 5000,
        intervals: [200],
      })
      .toBe(newContent);
  });

  test('no-arg launch saves content to default temp path', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    server = await launchServer();

    await page.goto(server.url);

    const savePath = (await editorState(page)).currentFile;
    expect(savePath).toBeTruthy();

    const content = '# Untitled Document\n\nThis file was created by the test.';
    await setEditorMarkdown(page, content);
    await pressSave(page);

    await expect
      .poll(() => readFileSync(savePath!, 'utf-8'), { timeout: 5000, intervals: [200] })
      .toBe(content);

    expect(errors).toEqual([]);

    try {
      unlinkSync(savePath!);
    } catch {
      /* ok */
    }
  });

  test('file path preserved across page reload', async ({ page }) => {
    tempCtx = withTempFile('# Persistent\n\nReload test.');
    server = await launchServer(undefined, tempCtx.path);

    await page.goto(server.url);
    await expectEditorMarkdown(page, '# Persistent\n\nReload test.');

    await page.reload();
    await expectEditorMarkdown(page, '# Persistent\n\nReload test.');
  });

  test('Explorer opens real files and Ctrl+S saves the selected file', async ({
    page,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'pandoc-explorer-'));
    const alphaPath = join(dir, 'alpha.md');
    const nestedDir = join(dir, 'nested');
    const betaPath = join(nestedDir, 'beta.txt');
    mkdirSync(nestedDir);
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(alphaPath, '# Alpha\n\nInitial alpha.', 'utf-8');
    writeFileSync(betaPath, '# Beta\n\nNested text file.', 'utf-8');
    writeFileSync(join(dir, 'node_modules', 'ignored.md'), '# Ignored', 'utf-8');
    writeFileSync(join(dir, 'image.png'), Buffer.from([0, 1, 2, 3]));
    tempCtx = { dir, path: alphaPath };
    server = await launchServer(undefined, alphaPath);

    await page.goto(server.url);
    await page.getByRole('button', { name: 'Toggle Explorer' }).click();

    await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /alpha\.md/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /nested/ })).toBeVisible();
    await expect(page.getByText('ignored.md')).toHaveCount(0);
    await expect(page.getByText('image.png')).toHaveCount(0);

    await page.getByRole('button', { name: /nested/ }).click();
    await page.getByRole('button', { name: /beta\.txt/ }).click();

    await expectEditorMarkdown(page, '# Beta\n\nNested text file.');
    const frame = page.frameLocator('#preview');
    await expect(frame.locator('h1')).toContainText('Beta', { timeout: 5000 });

    const edited = '# Beta Updated\n\nSaved through Explorer.';
    await setEditorMarkdown(page, edited);
    await pressSave(page);

    await expect
      .poll(() => readFileSync(betaPath, 'utf-8'), { timeout: 5000, intervals: [200] })
      .toBe(edited);
  });

  test('File New creates a real document and File Save writes it to disk', async ({
    page,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'pandoc-new-file-'));
    const originalPath = join(dir, 'original.md');
    const originalContent = '# Original\n\nKeep this file unchanged.';
    writeFileSync(originalPath, originalContent, 'utf-8');
    tempCtx = { dir, path: originalPath };
    server = await launchServer(undefined, originalPath);

    await page.goto(server.url);
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'New' }).click();

    const createdContent = '# Created From Menu\n\nSaved through File Save.';
    await setEditorMarkdown(page, createdContent);
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Save' }).click();

    await expect
      .poll(
        () => {
          const createdName = readdirSync(dir).find((name) =>
            /^untitled-[\w-]+\.md$/.test(name),
          );
          return createdName ? readFileSync(join(dir, createdName), 'utf-8') : null;
        },
        { timeout: 5000, intervals: [200] },
      )
      .toBe(createdContent);
    expect(readFileSync(originalPath, 'utf-8')).toBe(originalContent);
  });

  test('File Open uses Explorer selection and File Save targets the opened file', async ({
    page,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'pandoc-open-file-'));
    const originalPath = join(dir, 'original.md');
    const nestedDir = join(dir, 'nested');
    const openedPath = join(nestedDir, 'opened.md');
    const originalContent = '# Original\n\nThis must not be overwritten.';
    mkdirSync(nestedDir);
    writeFileSync(originalPath, originalContent, 'utf-8');
    writeFileSync(openedPath, '# Opened\n\nInitial opened file.', 'utf-8');
    tempCtx = { dir, path: originalPath };
    server = await launchServer(undefined, originalPath);

    await page.goto(server.url);
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Open' }).click();
    await expect(page.getByTestId('explorer-drawer')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /nested/ }).click();
    await page.getByRole('button', { name: /opened\.md/ }).click();
    await expectEditorMarkdown(page, '# Opened\n\nInitial opened file.');

    const edited = '# Opened Edited\n\nFile menu save targets this file.';
    await setEditorMarkdown(page, edited);
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Save' }).click();

    await expect
      .poll(() => readFileSync(openedPath, 'utf-8'), {
        timeout: 5000,
        intervals: [200],
      })
      .toBe(edited);
    expect(readFileSync(originalPath, 'utf-8')).toBe(originalContent);
  });

  test.afterEach(async () => {
    if (server) await killServer(server);
    if (tempCtx) cleanTemp(tempCtx.dir);
  });
});
