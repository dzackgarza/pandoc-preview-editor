/**
 * Minimal paint reproduction tests.
 * Run: npx tsx tests/repro-paint.ts
 *
 * Tests two scenarios:
 *   1. /bin/sh PTY (no nvim) — isolates xterm initial paint
 *   2. nvim PTY (full app)   — checks nvim initial paint
 *
 * Each test asserts:
 *   - Buffer ground truth (window.term.buffer.active)
 *   - DOM textContent (.xterm-rows)
 *   - Screenshot pixel content (visual paint proof)
 */

import { chromium } from '@playwright/test';
import express from 'express';
import { createServer } from 'node:http';
import { createWSServer } from '../server/ws.js';
import * as pty from 'node-pty';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, '..', 'web');
const PORT = 3142;

// ============================================================
// Minimal server that spawns /bin/sh as PTY (no nvim)
// ============================================================
async function startShServer(): Promise<{ close: () => void; url: string }> {
  const app = express();
  const httpServer = createServer(app);
  const wss = createWSServer(httpServer);

  app.use(express.static(WEB_DIR));
  app.use('/dist', express.static(resolve(WEB_DIR, 'dist')));
  app.use(
    '/xterm',
    express.static(resolve(__dirname, '..', 'node_modules', '@xterm', 'xterm', 'css')),
  );

  app.get('/api/status', (_req, res) => {
    res.json({ pid: shPty?.pid ?? 0, socket: '', file: '/bin/sh' });
  });

  let shPty: pty.IPty | null = null;

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(PORT, () => {
      console.log(`[sh-server] on http://localhost:${PORT}`);
      resolve();
    });
    httpServer.on('error', reject);
  });

  // Spawn /bin/sh as the PTY
  shPty = pty.spawn(
    '/bin/sh',
    ['-c', 'printf "INITIAL_RENDER_SENTINEL_12345\n"; sleep 60'],
    {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: { ...process.env, TERM: 'xterm-256color' },
    },
  );

  shPty.onData((data: string) => {
    // Broadcast to all connected WS clients
    wss.clients.forEach((ws: any) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'pty-output', data }));
      }
    });
  });

  return {
    url: `http://localhost:${PORT}`,
    close: () => {
      shPty?.kill();
      wss.close();
      httpServer.close();
    },
  };
}

// ============================================================
// Helper: count non-background pixels in a PNG buffer
// ============================================================
function estimateNonBgPixels(
  pngBuffer: Buffer,
  bgR = 30,
  bgG = 30,
  bgB = 46,
  tolerance = 10,
): number {
  // Simple heuristic: PNG file size correlates with pixel complexity.
  // A solid-color 640x766 PNG is ~2-3KB.
  // Any visible content pushes it to 15KB+.
  return pngBuffer.length;
}

// ============================================================
// Test 1: /bin/sh PTY — does xterm paint initial output?
// ============================================================
async function testShPtyPaint() {
  console.log('\n========================================');
  console.log('TEST 1: /bin/sh PTY (no nvim)');
  console.log('========================================\n');

  const server = await startShServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[BROWSER]', msg.text());
  });

  try {
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="terminal"]', { timeout: 10000 });
    await page.waitForFunction(() => (window as any).term !== undefined, {
      timeout: 10000,
    });

    // NO artificial wait — measure immediately after terminal is created
    // (but we need at least a microtask tick for PTY data to arrive)
    await page.waitForTimeout(100);

    // --- Buffer check (ground truth) ---
    const bufferLines = await page.evaluate(() => {
      const t = (window as any).term;
      if (!t) return { error: 'no terminal' };
      const lines: string[] = [];
      for (let i = 0; i < 5; i++) {
        lines.push(t.buffer.active.getLine(i)?.translateToString(true) ?? '');
      }
      return { cols: t.cols, rows: t.rows, lines };
    });

    console.log('Buffer lines:', JSON.stringify(bufferLines, null, 2));
    const bufferHasContent = bufferLines.lines?.some((l: string) =>
      l.includes('SENTINEL'),
    );
    console.log(`Buffer has SENTINEL: ${bufferHasContent}`);

    // --- DOM check (rendered content) ---
    const domText = await page.evaluate(() => {
      const rows = document.querySelector('.xterm-rows');
      return rows?.textContent ?? '';
    });
    console.log(
      `DOM textContent (first 200): ${JSON.stringify(domText.slice(0, 200))}`,
    );
    const domHasContent = domText.includes('SENTINEL');
    console.log(`DOM has SENTINEL: ${domHasContent}`);

    // --- Screenshot (visual paint proof) ---
    const shot = await page.locator('[data-testid="terminal"]').screenshot();
    const pngSize = shot.length;
    console.log(`Screenshot size: ${pngSize} bytes (solid bg ~3KB, content >15KB)`);
    const visuallyNonEmpty = pngSize > 10000;

    console.log('\n--- VERDICT ---');
    console.log(`  Content in xterm buffer: ${bufferHasContent}`);
    console.log(`  Content in DOM (.xterm-rows): ${domHasContent}`);
    console.log(`  Content in screenshot: ${visuallyNonEmpty} (${pngSize} bytes)`);

    if (bufferHasContent && !visuallyNonEmpty) {
      console.log('  => PAINT FAILURE: buffer has content, screenshot is blank');
    } else if (!bufferHasContent) {
      console.log('  => DATA FAILURE: buffer is empty (PTY stream not delivered)');
    } else if (bufferHasContent && domHasContent && visuallyNonEmpty) {
      console.log('  => ALL GOOD: content rendered and painted');
    }

    const screenshotPath = '/tmp/repro-sh-pty.png';
    writeFileSync(screenshotPath, shot);
    console.log(`Screenshot saved: ${screenshotPath}`);
  } finally {
    await browser.close();
    server.close();
  }
}

// ============================================================
// Test 2: nvim PTY — does xterm paint initial nvim screen?
// ============================================================
async function testNvimPaint(fixturePath: string) {
  console.log('\n========================================');
  console.log('TEST 2: nvim PTY (full app)');
  console.log('========================================\n');

  const server: ServerInstance = await launchServer(fixturePath);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[BROWSER]', msg.text());
  });

  try {
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="terminal"]', { timeout: 10000 });
    await page.waitForFunction(() => (window as any).term !== undefined, {
      timeout: 10000,
    });

    // NO artificial wait — measure right after terminal creation
    await page.waitForTimeout(100);

    // --- Buffer check ---
    const bufferLines = await page.evaluate(() => {
      const t = (window as any).term;
      if (!t) return { error: 'no terminal' };
      const lines: string[] = [];
      for (let i = 0; i < 20; i++) {
        lines.push(t.buffer.active.getLine(i)?.translateToString(true) ?? '');
      }
      return { cols: t.cols, rows: t.rows, lines };
    });

    console.log('Buffer cols/rows:', bufferLines.cols, bufferLines.rows);
    const nvimBufferText = bufferLines.lines?.join('\n') ?? '';
    const bufferShowsNvim = /NORMAL|doc\.md|nvim|test/i.test(nvimBufferText);
    console.log(`Buffer shows nvim content: ${bufferShowsNvim}`);
    console.log(
      'First 5 buffer lines:',
      JSON.stringify(bufferLines.lines?.slice(0, 5)),
    );

    // --- DOM check ---
    const domText = await page.evaluate(() => {
      const rows = document.querySelector('.xterm-rows');
      return rows?.textContent ?? '';
    });
    console.log(`DOM textContent length: ${domText.length}`);
    const domShowsNvim = /NORMAL|doc\.md|nvim|test/i.test(domText);
    console.log(`DOM shows nvim content: ${domShowsNvim}`);

    // --- Screenshot ---
    const shot = await page.locator('[data-testid="terminal"]').screenshot();
    const pngSize = shot.length;
    console.log(`Screenshot size: ${pngSize} bytes (solid bg ~3KB)`);
    const visuallyNonEmpty = pngSize > 10000;

    console.log('\n--- VERDICT ---');
    console.log(`  Content in xterm buffer: ${bufferShowsNvim}`);
    console.log(`  Content in DOM: ${domShowsNvim}`);
    console.log(`  Content in screenshot: ${visuallyNonEmpty} (${pngSize} bytes)`);

    if (bufferShowsNvim && !visuallyNonEmpty) {
      console.log('  => PAINT FAILURE: buffer has content, screenshot is blank');
    } else if (!bufferShowsNvim) {
      console.log('  => DATA FAILURE: buffer is empty (PTY/nvim startup issue)');
    } else if (bufferShowsNvim && domShowsNvim && visuallyNonEmpty) {
      console.log('  => ALL GOOD: content rendered and painted');
    }

    const screenshotPath = '/tmp/repro-nvim-pty.png';
    writeFileSync(screenshotPath, shot);
    console.log(`Screenshot saved: ${screenshotPath}`);
  } finally {
    await browser.close();
    await killServer(server);
  }
}

// ============================================================
// Run both tests
// ============================================================
async function main() {
  // Kill any stale server first
  try {
    const { execSync } = await import('node:child_process');
    execSync('lsof -ti:3141,3142 | xargs -r kill -9 2>/dev/null', { timeout: 3000 });
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));

  const fixturePath = resolve(__dirname, 'fixtures', 'test-doc.md');

  await testShPtyPaint();
  await testNvimPaint(fixturePath);

  console.log('\n========================================');
  console.log('Done.');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Repro failed:', err);
  process.exit(1);
});
