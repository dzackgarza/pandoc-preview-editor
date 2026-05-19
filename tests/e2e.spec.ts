import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import {
  launchServer,
  killServer,
  seedTempFile,
  readFile,
  nvimDirectRPC,
  type ServerInstance,
} from './helpers.js';

const FIXTURE = 'tests/fixtures/test-doc.md';

let server: ServerInstance;

// Terminal pane shows nvim content without requiring keystrokes
test('terminal pane shows nvim on initial load', async ({ page }) => {
  server = await launchServer(FIXTURE);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(2000);

    const hasText = await page.evaluate(() => {
      const rows = document.querySelector('.xterm-rows');
      if (!rows) return false;
      return rows.textContent !== null && rows.textContent.trim().length > 0;
    });

    expect(hasText).toBe(true);
  } finally {
    await killServer(server);
  }
});

// Preview shows rendered content on initial load, before any keystrokes
test('preview shows content on initial load without typing', async ({ page }) => {
  server = await launchServer(FIXTURE);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(3000);

    const preview = page.frameLocator('[data-testid="preview-frame"]');

    await expect(preview.locator('h1').first()).toContainText('Test Document', {
      timeout: 5000,
    });

    await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached({
      timeout: 5000,
    });
  } finally {
    await killServer(server);
  }
});

// Preview updates on buffer change without explicit :w or save
test('preview updates on buffer change without save', async ({ page }) => {
  const f = seedTempFile('auto-update', '# Starting Header\n\nSome text.\n');
  server = await launchServer(f);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.getByTestId('terminal').click();
    await page.keyboard.type('i# Auto Update Header');
    await page.keyboard.press('Escape');

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('h1').last()).toContainText('Auto Update Header', {
      timeout: 5000,
    });
  } finally {
    await killServer(server);
  }
});

// Keyboard input reaches real nvim buffer AND writes to disk
test('keyboard input reaches nvim buffer and persists to file', async ({ page }) => {
  const f = seedTempFile('kb-input', '# Start\n\n');
  server = await launchServer(f);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.getByTestId('terminal').click();
    await page.keyboard.type('iNEW_CONTENT_FROM_KEYBOARD');
    await page.keyboard.press('Escape');

    await page.evaluate(async () => {
      await fetch('/api/save', { method: 'POST' });
    });
    await page.waitForTimeout(500);

    const diskContent = readFile(f);
    expect(diskContent).toContain('NEW_CONTENT_FROM_KEYBOARD');
  } finally {
    await killServer(server);
  }
});

// Nvim input updates pandoc preview DOM, and file on disk matches
test('nvim input updates pandoc preview DOM and file on disk', async ({ page }) => {
  const f = seedTempFile('preview-dom', '# Old Header\n\n');
  server = await launchServer(f);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.getByTestId('terminal').click();

    await page.keyboard.type('ggdG');
    await page.keyboard.type('i# Theorem');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Let $E=mc^2$');
    await page.keyboard.press('.');
    await page.keyboard.press('Escape');

    await page.waitForTimeout(1000);

    await page.evaluate(async () => {
      await fetch('/api/save', { method: 'POST' });
    });
    await page.waitForTimeout(500);

    const diskContent = readFile(f);
    expect(diskContent).toContain('Theorem');
    expect(diskContent).toContain('E=mc^2');

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('h1').last()).toContainText('Theorem');
    await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached({
      timeout: 5000,
    });
  } finally {
    await killServer(server);
  }
});

// Save uses live nvim buffer, not stale cache
test('save uses live nvim buffer not stale cache', async ({ page }) => {
  const f = seedTempFile('save-live', '# Before\n\n');
  server = await launchServer(f);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.getByTestId('terminal').click();
    await page.keyboard.type('iAFTER_SAVE_SENTINEL_X');
    await page.keyboard.press('Escape');

    await page.evaluate(async () => {
      await fetch('/api/save', { method: 'POST' });
    });
    await page.waitForTimeout(500);

    const diskContent = readFile(f);
    expect(diskContent).toContain('AFTER_SAVE_SENTINEL_X');
  } finally {
    await killServer(server);
  }
});

// Pandoc math and citations render in preview, file has source
test('pandoc math and citations render and file contains source', async ({ page }) => {
  const f = seedTempFile('math-cite', '# Cites\n\n');
  server = await launchServer(f);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

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
  } finally {
    await killServer(server);
  }
});

// Certification uses production runtime only
test('certification uses production runtime only', async ({ page }) => {
  server = await launchServer(FIXTURE);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });

    const proc = execSync('ps aux', { encoding: 'utf-8', timeout: 3000 })
      .split('\n')
      .filter((l) => l.includes('nvim') && !l.includes('[nvim]'));
    expect(proc.length).toBeGreaterThan(0);

    await expect(
      page.locator('[data-testid="terminal"][data-active="true"]'),
    ).toBeAttached({ timeout: 5000 });

    await expect(page.locator('[data-testid="preview-frame"]')).toBeAttached();

    const statusRes = await fetch(`${server.url}/api/status`);
    const statusData = (await statusRes.json()) as any;
    expect(statusData.pid).toBeGreaterThan(0);
    expect(statusData.socket).toBe(server.socketPath);
  } finally {
    await killServer(server);
  }
});
