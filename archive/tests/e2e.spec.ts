import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchServer,
  killServer,
  seedTempFile,
  readFile,
  nvimDirectRPC,
  type ServerInstance,
} from './helpers.js';
import { pngStats } from './png-stats.js';

const FIXTURE = 'tests/fixtures/test-doc.md';

let server: ServerInstance;

interface RenderStatus {
  completed: number;
  completedSeq: number | null;
  inFlight: boolean;
  skippedUnchanged: number;
  started: number;
}

test('slow pandoc renders coalesce to first then latest and skip unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pnp-render-queue-'));
  const file = join(dir, 'doc.md');
  const filter = join(dir, 'slow-log.lua');
  const log = join(dir, 'render.log');
  const config = join(dir, 'pandoc-preview.toml');
  const previousLogEnv = process.env.PANDOC_PREVIEW_TEST_LOG;

  writeFileSync(file, '# Initial\n\nBody.\n', 'utf-8');
  writeFileSync(
    filter,
    [
      'function Pandoc(doc)',
      '  local text = pandoc.utils.stringify(doc)',
      '  local marker = string.match(text, "FIFO_FIRST") or string.match(text, "LATEST_%d+") or text',
      '  local log = os.getenv("PANDOC_PREVIEW_TEST_LOG")',
      '  local f = io.open(log, "a")',
      '  f:write(marker .. "\\n")',
      '  f:close()',
      '  os.execute("sleep 0.4")',
      '  return doc',
      'end',
      '',
    ].join('\n'),
    'utf-8',
  );
  chmodSync(filter, 0o755);
  writeFileSync(
    config,
    [
      '[render]',
      'debounce_ms = 50',
      'timeout_ms = 10000',
      '',
      '[pandoc]',
      'command = "pandoc"',
      'args = [',
      '  "-f",',
      '  "markdown+tex_math_dollars+citations",',
      '  "-t",',
      '  "html",',
      '  "--standalone",',
      '  "--citeproc",',
      '  "--mathjax",',
      '  "--lua-filter",',
      `  "${tomlString(filter)}",`,
      ']',
      '',
    ].join('\n'),
    'utf-8',
  );

  process.env.PANDOC_PREVIEW_TEST_LOG = log;
  server = await launchServer(file, { configPath: config });
  try {
    await postBuffer(server.url, '# FIFO_FIRST\n\nThe first render starts.\n');

    await expect
      .poll(() => renderStatus(server.url), { timeout: 5000 })
      .toMatchObject({ inFlight: true, started: 1 });

    for (let i = 2; i <= 10; i++) {
      await postBuffer(server.url, `# LATEST_${i}\n\nThe latest state is ${i}.\n`);
    }

    await expect
      .poll(() => renderStatus(server.url), { timeout: 15000 })
      .toMatchObject({ completed: 2, completedSeq: 10, inFlight: false });

    expect(readLogLines(log)).toEqual(['FIFO_FIRST', 'LATEST_10']);

    await postBuffer(server.url, '# LATEST_10\n\nThe latest state is 10.\n');

    await expect
      .poll(() => renderStatus(server.url), { timeout: 5000 })
      .toMatchObject({ completed: 2, skippedUnchanged: 1 });

    expect(readLogLines(log)).toEqual(['FIFO_FIRST', 'LATEST_10']);
  } finally {
    if (previousLogEnv === undefined) {
      delete process.env.PANDOC_PREVIEW_TEST_LOG;
    } else {
      process.env.PANDOC_PREVIEW_TEST_LOG = previousLogEnv;
    }
    await killServer(server);
  }
});

// Terminal pane visibly paints nvim content without requiring keystrokes
test('terminal pane visibly paints nvim on initial load', async ({
  page,
}, testInfo) => {
  server = await launchServer(FIXTURE);
  try {
    await page.goto(server.url);
    const terminal = page.getByTestId('terminal');
    await expect(terminal).toBeVisible({ timeout: 10000 });

    await expect
      .poll(
        async () => {
          const statusRes = await fetch(`${server.url}/api/status`);
          return ((await statusRes.json()) as { pid: number }).pid;
        },
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const terminalRect = document
            .querySelector('[data-testid="terminal"]')
            ?.getBoundingClientRect();
          const rows = document.querySelector('.xterm-rows');
          return {
            width: terminalRect?.width ?? 0,
            height: terminalRect?.height ?? 0,
            rowsText: rows?.textContent ?? '',
          };
        }),
      )
      .toMatchObject({
        rowsText: expect.stringContaining('test-doc.md'),
      });

    const terminalRect = await page.evaluate(() => {
      const rect = document
        .querySelector('[data-testid="terminal"]')
        ?.getBoundingClientRect();
      return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
    });

    const rowsText = await page.evaluate(() => {
      const rows = document.querySelector('.xterm-rows');
      return rows?.textContent ?? '';
    });

    expect(terminalRect.width, 'terminal must be fitted to real width').toBeGreaterThan(
      40,
    );
    expect(
      terminalRect.height,
      'terminal must be fitted to real height',
    ).toBeGreaterThan(10);
    expect(rowsText, 'terminal DOM rows must contain visible nvim/file text').toContain(
      'test-doc.md',
    );

    const screenshot = await terminal.screenshot();
    writeFileSync(testInfo.outputPath('terminal-initial.png'), screenshot);
    const stats = pngStats(screenshot);

    expect(stats.uniqueColors, 'terminal screenshot must not be a flat fill').toBeGreaterThan(
      10,
    );
    expect(
      stats.nonDominantPixels,
      'terminal screenshot must contain painted foreground glyphs',
    ).toBeGreaterThan(1000);
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

    await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached(
      {
        timeout: 5000,
      },
    );
  } finally {
    // Log server output for debugging if test failed
    if (server) {
      const stdout = server.out.join('').slice(-2000);
      const stderr = server.err.join('').slice(-2000);
      if (stdout) console.log('\n=== SERVER STDOUT ===\n' + stdout);
      if (stderr) console.log('\n=== SERVER STDERR ===\n' + stderr);
    }
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
    await page.keyboard.type('ggO# Auto Update Header');
    await page.keyboard.press('Escape');

    await expect
      .poll(() =>
        nvimDirectRPC(server.socketPath, 'join(getline(1, "$"), "\\n")'),
      )
      .toContain('# Auto Update Header');

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('h1').first()).toContainText('Auto Update Header', {
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
    await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached(
      {
        timeout: 5000,
      },
    );
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
    await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached(
      {
        timeout: 5000,
      },
    );
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

async function postBuffer(url: string, markdown: string): Promise<void> {
  const res = await fetch(`${url}/api/buffer-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: markdown,
  });
  expect(res.status).toBe(202);
}

async function renderStatus(url: string): Promise<RenderStatus> {
  const res = await fetch(`${url}/api/render-status`);
  expect(res.status).toBe(200);
  return (await res.json()) as RenderStatus;
}

function readLogLines(path: string): string[] {
  return readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
}

function tomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
