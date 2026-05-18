import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/**
 * The bug: nvim's completion popup true-color escape sequences leak as
 * literal text. e.g. "inc[38;2;147;153;179mLude" instead of colored text.
 *
 * This reproduces by typing in nvim to trigger completions, then checking
 * the rendered terminal DOM for leaked escape codes.
 */
test('RED: completion popup true-color escapes do not leak as literal text', async ({ page }) => {
  // Start server manually (helpers.ts has import.meta.dirname issues)
  const file = '/tmp/esc-leak-test5.md';
  writeFileSync(file, '# Test\n');

  // Find free port
  const net = await import('node:net');
  const port = await new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, () => { resolve((s.address() as any).port); s.close(); });
  });

  const server = spawn('npx', ['tsx', 'server/cli.ts', file, '--port', String(port), '--no-open'], {
    cwd: '/home/dzack/gitclones/pandoc-preview',
    env: { ...process.env, NO_OPEN: '1' },
    stdio: 'pipe',
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  // Wait for server ready
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 20000;
    function check() {
      if (Date.now() > deadline) { reject(new Error('Server timeout')); return; }
      fetch(`http://localhost:${port}/api/status`)
        .then(r => { if (r.ok) resolve(); else setTimeout(check, 200); })
        .catch(() => setTimeout(check, 200));
    }
    check();
  });

  try {
    await page.goto(`http://localhost:${port}`);
    await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
    await page.waitForSelector('.xterm', { timeout: 10000 });
    await page.waitForTimeout(3000);

    // Type 'i' to enter insert mode, then 'inc' to trigger completion
    const termScreen = page.locator('.xterm-screen');
    await termScreen.click();
    await page.waitForTimeout(300);

    await page.keyboard.press('i');
    await page.waitForTimeout(400);
    await page.keyboard.type('inc', { delay: 80 });
    await page.waitForTimeout(3000);

    // Read ALL DOM text from xterm rows
    const domText = await page.evaluate(() => {
      const rows = document.querySelector('.xterm-rows');
      return rows ? rows.textContent || '' : '';
    });

    console.log('=== DOM TEXT (last 600 chars) ===');
    console.log(domText.slice(-600));

    // Real escape leak patterns (SGR true-color codes)
    // These should NEVER appear as visible text in the terminal
    const realEscapeLeaks = [
      '[38;2;',   // true-color fg with bracket (ESC byte missing, bracket leaks)
      '[48;2;',   // true-color bg with bracket
    ];

    const leaked = realEscapeLeaks.filter(p => domText.includes(p));
    console.log('Leaked patterns found:', leaked.length > 0 ? leaked : 'none');

    // THIS IS THE RED TEST — should FAIL if escape sequences leak as text
    expect(leaked.length, `Leaked escapes: ${leaked.join(', ')}`).toBe(0);

    await page.screenshot({ path: '/tmp/esc-leak-test5.png' });

  } finally {
    server.kill('SIGKILL');
  }
});
