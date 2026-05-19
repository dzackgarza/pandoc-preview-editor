import { test, expect } from '@playwright/test';
import {
  writeFileSync,
  unlinkSync,
  readFileSync,
  mkdtempSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { randomUUID } from 'node:crypto';

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
    unlinkSync(join(dir, 'test.md'));
    try {
      unlinkSync(join(dir, 'test.md~'));
    } catch {
      /* ok */
    }
    unlinkSync(dir);
  } catch {
    /* best effort */
  }
}

test.describe('file loading and saving', () => {
  let server: ServerInstance;
  let tempCtx: { dir: string; path: string };

  test('CLI file argument loads content into textarea', async ({ page }) => {
    tempCtx = withTempFile('# Loaded File\n\nThis content comes from disk.');
    server = await launchServer(undefined, tempCtx.path);

    await page.goto(server.url);

    const editor = page.locator('#editor');
    await expect(editor).toHaveValue('# Loaded File\n\nThis content comes from disk.', {
      timeout: 5000,
    });

    // Preview should also render the file content
    const frame = page.frameLocator('#preview');
    await expect(frame.locator('h1')).toContainText('Loaded File', { timeout: 5000 });
  });

  test('Ctrl+S saves textarea content to disk', async ({ page }) => {
    tempCtx = withTempFile('# Original\n');
    server = await launchServer(undefined, tempCtx.path);

    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('# Modified\n\nNew content.');
    await editor.press('Control+s');

    // Wait a moment for the save to complete and re-read the file
    await page.waitForTimeout(500);

    const onDisk = readFileSync(tempCtx.path, 'utf-8');
    expect(onDisk).toContain('# Modified');
    expect(onDisk).toContain('New content.');
    expect(onDisk).not.toContain('# Original');
  });

  test('no-arg launch prompts for save path on Ctrl+S', async ({ page }) => {
    // Launch WITHOUT a file argument — save should prompt for a path
    server = await launchServer();

    await page.goto(server.url);
    const editor = page.locator('#editor');
    await expect(editor).toHaveValue('', { timeout: 5000 });

    // Set up dialog handler before pressing Ctrl+S
    const saveDir = mkdtempSync(join(tmpdir(), 'pandoc-saveas-'));
    const savePath = join(saveDir, 'new-doc.md');

    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept(savePath);
    });

    await editor.fill('# New Document\n\nCreated from save-as.');
    await editor.press('Control+s');

    // Wait for the file to appear on disk
    await expect
      .poll(() => existsSync(savePath), { timeout: 5000, intervals: [200, 200, 200] })
      .toBe(true);

    const onDisk = readFileSync(savePath, 'utf-8');
    expect(onDisk).toContain('# New Document');
    expect(onDisk).toContain('Created from save-as.');

    // Second Ctrl+S should save to the same path without prompting
    await editor.fill('# Updated');
    await editor.press('Control+s');
    await page.waitForTimeout(300);
    const updated = readFileSync(savePath, 'utf-8');
    expect(updated).toContain('# Updated');

    // Cleanup
    try {
      unlinkSync(savePath);
    } catch {
      /* ok */
    }
    try {
      unlinkSync(saveDir);
    } catch {
      /* ok */
    }
  });

  test('file path preserved across page reload', async ({ page }) => {
    tempCtx = withTempFile('# Persistent\n\nReload test.');
    server = await launchServer(undefined, tempCtx.path);

    await page.goto(server.url);
    await expect(page.locator('#editor')).toHaveValue('# Persistent\n\nReload test.', {
      timeout: 5000,
    });

    await page.reload();
    await expect(page.locator('#editor')).toHaveValue('# Persistent\n\nReload test.', {
      timeout: 5000,
    });
  });

  test.afterEach(async () => {
    if (server) await killServer(server);
    if (tempCtx) cleanTemp(tempCtx.dir);
  });
});
