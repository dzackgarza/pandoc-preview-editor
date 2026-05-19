import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { launchServer, killServer, type ServerInstance } from './helpers.js';

/**
 * The bug: nvim's completion popup true-color escape sequences leak as
 * literal text. e.g. "inc[38;2;147;153;179mLude" instead of colored text.
 *
 * This reproduces by typing in nvim to trigger completions, then checking
 * the rendered terminal DOM for leaked escape codes.
 */
test('RED: completion popup true-color escapes do not leak as literal text', async ({ page }) => {
  const file = '/tmp/esc-leak-test5.md';
  writeFileSync(file, '# Test\n');

  let server: ServerInstance | null = null;
  try {
    server = await launchServer(file);

    await page.goto(server.url);
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
    if (server) await killServer(server);
  }
});
