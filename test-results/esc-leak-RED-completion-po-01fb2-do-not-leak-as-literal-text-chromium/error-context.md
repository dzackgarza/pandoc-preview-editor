# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: esc-leak.spec.ts >> RED: completion popup true-color escapes do not leak as literal text
- Location: tests/esc-leak.spec.ts:12:1

# Error details

```
Error: Server timeout
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { spawn } from 'node:child_process';
  3  | import { writeFileSync } from 'node:fs';
  4  | 
  5  | /**
  6  |  * The bug: nvim's completion popup true-color escape sequences leak as
  7  |  * literal text. e.g. "inc[38;2;147;153;179mLude" instead of colored text.
  8  |  *
  9  |  * This reproduces by typing in nvim to trigger completions, then checking
  10 |  * the rendered terminal DOM for leaked escape codes.
  11 |  */
  12 | test('RED: completion popup true-color escapes do not leak as literal text', async ({ page }) => {
  13 |   // Start server manually (helpers.ts has import.meta.dirname issues)
  14 |   const file = '/tmp/esc-leak-test5.md';
  15 |   writeFileSync(file, '# Test\n');
  16 | 
  17 |   // Find free port
  18 |   const net = await import('node:net');
  19 |   const port = await new Promise<number>((resolve) => {
  20 |     const s = net.createServer();
  21 |     s.listen(0, () => { resolve((s.address() as any).port); s.close(); });
  22 |   });
  23 | 
  24 |   const server = spawn('npx', ['tsx', 'server/cli.ts', file, '--port', String(port), '--no-open'], {
  25 |     cwd: '/home/dzack/gitclones/pandoc-preview',
  26 |     env: { ...process.env, NO_OPEN: '1' },
  27 |     stdio: 'pipe',
  28 |   });
  29 |   server.stdout.on('data', () => {});
  30 |   server.stderr.on('data', () => {});
  31 | 
  32 |   // Wait for server ready
  33 |   await new Promise<void>((resolve, reject) => {
  34 |     const deadline = Date.now() + 20000;
  35 |     function check() {
> 36 |       if (Date.now() > deadline) { reject(new Error('Server timeout')); return; }
     |                                           ^ Error: Server timeout
  37 |       fetch(`http://localhost:${port}/api/status`)
  38 |         .then(r => { if (r.ok) resolve(); else setTimeout(check, 200); })
  39 |         .catch(() => setTimeout(check, 200));
  40 |     }
  41 |     check();
  42 |   });
  43 | 
  44 |   try {
  45 |     await page.goto(`http://localhost:${port}`);
  46 |     await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  47 |     await page.waitForSelector('.xterm', { timeout: 10000 });
  48 |     await page.waitForTimeout(3000);
  49 | 
  50 |     // Type 'i' to enter insert mode, then 'inc' to trigger completion
  51 |     const termScreen = page.locator('.xterm-screen');
  52 |     await termScreen.click();
  53 |     await page.waitForTimeout(300);
  54 | 
  55 |     await page.keyboard.press('i');
  56 |     await page.waitForTimeout(400);
  57 |     await page.keyboard.type('inc', { delay: 80 });
  58 |     await page.waitForTimeout(3000);
  59 | 
  60 |     // Read ALL DOM text from xterm rows
  61 |     const domText = await page.evaluate(() => {
  62 |       const rows = document.querySelector('.xterm-rows');
  63 |       return rows ? rows.textContent || '' : '';
  64 |     });
  65 | 
  66 |     console.log('=== DOM TEXT (last 600 chars) ===');
  67 |     console.log(domText.slice(-600));
  68 | 
  69 |     // Real escape leak patterns (SGR true-color codes)
  70 |     // These should NEVER appear as visible text in the terminal
  71 |     const realEscapeLeaks = [
  72 |       '[38;2;',   // true-color fg with bracket (ESC byte missing, bracket leaks)
  73 |       '[48;2;',   // true-color bg with bracket
  74 |     ];
  75 | 
  76 |     const leaked = realEscapeLeaks.filter(p => domText.includes(p));
  77 |     console.log('Leaked patterns found:', leaked.length > 0 ? leaked : 'none');
  78 | 
  79 |     // THIS IS THE RED TEST — should FAIL if escape sequences leak as text
  80 |     expect(leaked.length, `Leaked escapes: ${leaked.join(', ')}`).toBe(0);
  81 | 
  82 |     await page.screenshot({ path: '/tmp/esc-leak-test5.png' });
  83 | 
  84 |   } finally {
  85 |     server.kill('SIGKILL');
  86 |   }
  87 | });
  88 | 
```