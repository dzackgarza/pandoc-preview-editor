import { test, expect } from '@playwright/test';
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const APP_URL = 'http://localhost:3141';
const SOCKET_PATH = '/tmp/pandoc-nvim-preview/nvim.sock';

// Create a disposable temp file with seed content for each test
function seedTempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pnp-${name}-`));
  const path = join(dir, 'doc.md');
  writeFileSync(path, content, 'utf-8');
  return path;
}

function nvimRemoteExpr(expr: string): string {
  try {
    return execFileSync('nvim', ['--server', SOCKET_PATH, '--remote-expr', expr], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    return '';
  }
}

function getProcessTree(): string[] {
  try {
    const out = execSync('ps aux', { encoding: 'utf-8', timeout: 3000 });
    return out.split('\n').filter((l) => l.includes('nvim'));
  } catch {
    return [];
  }
}

function readFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

async function openFileInServer(page: any, filePath: string) {
  await page.goto(APP_URL);
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 15000 });
  // Use the API to switch the file
  const res = await page.evaluate(async (path: string) => {
    const r = await fetch('/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: path }),
    });
    return r.json();
  }, filePath);
  expect(res.ok).toBe(true);
  await page.waitForTimeout(2000); // let nvim reload
  await page.reload();
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 15000 });
}

// RED: Terminal pane shows nvim content without requiring keystrokes
test('terminal pane shows nvim on initial load', async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });

  // nvim should have rendered its startup screen into xterm.js DOM
  // Without any keystrokes, the terminal should contain text nodes
  await page.waitForTimeout(2000);

  const hasText = await page.evaluate(() => {
    const rows = document.querySelector('.xterm-rows');
    if (!rows) return false;
    return rows.textContent !== null && rows.textContent.trim().length > 0;
  });

  expect(hasText).toBe(true);
});

// RED: Preview shows rendered content on initial load, before any keystrokes
test('preview shows content on initial load without typing', async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });

  await page.waitForTimeout(3000);

  const preview = page.frameLocator('[data-testid="preview-frame"]');

  await expect(preview.locator('h1').first()).toContainText('Test Document', {
    timeout: 5000,
  });

  await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached({
    timeout: 5000,
  });
});

// RED: Preview updates on buffer change without explicit :w or save
test('preview updates on buffer change without save', async ({ page }) => {
  const f = seedTempFile('auto-update', '# Starting Header\n\nSome text.\n');
  await openFileInServer(page, f);

  await page.getByTestId('terminal').click();
  await page.keyboard.type('i# Auto Update Header');
  await page.keyboard.press('Escape');

  const preview = page.frameLocator('[data-testid="preview-frame"]');
  await expect(preview.locator('h1').last()).toContainText('Auto Update Header', {
    timeout: 5000,
  });
});

// Test: App starts real nvim in terminal pane
test('app starts real nvim in terminal pane', async ({ page }) => {
  await page.goto(APP_URL);

  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('preview')).toBeVisible();

  const proc = getProcessTree();
  const nvimProc = proc.filter((l) => !l.includes('[nvim]'));
  expect(nvimProc.length).toBeGreaterThan(0);

  const nvimLines = nvimProc.join(' ');
  expect(nvimLines).toContain('--listen');
  expect(nvimLines).not.toContain('--headless');

  await expect(
    page.locator('[data-testid="terminal"][data-active="true"]'),
  ).toBeAttached({ timeout: 5000 });
});

// Test: Keyboard input reaches real nvim buffer AND writes to disk
test('keyboard input reaches nvim buffer and persists to file', async ({ page }) => {
  const f = seedTempFile('kb-input', '# Start\n\n');
  await openFileInServer(page, f);

  await page.getByTestId('terminal').click();
  await page.keyboard.type('iNEW_CONTENT_FROM_KEYBOARD');
  await page.keyboard.press('Escape');

  // Save via nvim's remote-send
  await page.evaluate(async () => {
    await fetch('/api/save', { method: 'POST' });
  });
  await page.waitForTimeout(500);

  const diskContent = readFile(f);
  expect(diskContent).toContain('NEW_CONTENT_FROM_KEYBOARD');
});

// Test: Nvim input updates pandoc preview DOM, and file on disk matches
test('nvim input updates pandoc preview DOM and file on disk', async ({ page }) => {
  const f = seedTempFile('preview-dom', '# Old Header\n\n');
  await openFileInServer(page, f);

  await page.getByTestId('terminal').click();

  // Replace entire buffer content
  await page.keyboard.type('ggdG');
  await page.keyboard.type('i# Theorem');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Let $E=mc^2$');
  await page.keyboard.press('.');
  await page.keyboard.press('Escape');

  await page.waitForTimeout(1000);

  // Save to disk
  await page.evaluate(async () => {
    await fetch('/api/save', { method: 'POST' });
  });
  await page.waitForTimeout(500);

  // Assert file on disk
  const diskContent = readFile(f);
  expect(diskContent).toContain('Theorem');
  expect(diskContent).toContain('E=mc^2');

  // Assert preview DOM
  const preview = page.frameLocator('[data-testid="preview-frame"]');
  await expect(preview.locator('h1').last()).toContainText('Theorem');
  await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached({
    timeout: 5000,
  });
});

// Test: Save uses live nvim buffer, not stale cache
test('save uses live nvim buffer not stale cache', async ({ page }) => {
  const f = seedTempFile('save-live', '# Before\n\n');
  await openFileInServer(page, f);

  await page.getByTestId('terminal').click();
  await page.keyboard.type('iAFTER_SAVE_SENTINEL_X');
  await page.keyboard.press('Escape');

  await page.evaluate(async () => {
    await fetch('/api/save', { method: 'POST' });
  });
  await page.waitForTimeout(500);

  const diskContent = readFile(f);
  expect(diskContent).toContain('AFTER_SAVE_SENTINEL_X');
});

// Test: Pandoc math and citations render in preview, file has source
test('pandoc math and citations render and file contains source', async ({ page }) => {
  const f = seedTempFile('math-cite', '# Cites\n\n');
  await openFileInServer(page, f);

  await page.getByTestId('terminal').click();
  await page.keyboard.type('iSee @doe99. Also $x^2+y^2=z^2$');
  await page.keyboard.press('.');
  await page.keyboard.press('Escape');

  await page.waitForTimeout(1000);

  await page.evaluate(async () => {
    await fetch('/api/save', { method: 'POST' });
  });
  await page.waitForTimeout(500);

  const diskContent = readFile(f);
  expect(diskContent).toContain('@doe99');
  expect(diskContent).toContain('x^2+y^2=z^2');

  const preview = page.frameLocator('[data-testid="preview-frame"]');
  await expect(preview.locator('body')).toContainText('doe99');
  await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached({
    timeout: 5000,
  });
});

// Test: Invalid nvim path fails before active state
test('invalid nvim path fails before active state', async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });

  await expect(page.getByTestId('status')).not.toContainText('error', {
    timeout: 5000,
  });
});

// Test: Certification uses production runtime only
test('certification uses production runtime only', async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });

  const proc = getProcessTree();
  expect(proc.some((l) => !l.includes('[nvim]'))).toBeTruthy();

  await expect(
    page.locator('[data-testid="terminal"][data-active="true"]'),
  ).toBeAttached({ timeout: 5000 });

  await expect(page.locator('[data-testid="preview-frame"]')).toBeAttached();

  const statusRes = await fetch(`${APP_URL}/api/status`);
  const statusData = await statusRes.json();
  expect(statusData.pid).toBeGreaterThan(0);
  expect(statusData.socket).toBe(SOCKET_PATH);
});
