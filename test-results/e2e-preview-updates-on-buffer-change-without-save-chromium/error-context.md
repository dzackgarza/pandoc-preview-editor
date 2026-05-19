# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e.spec.ts >> preview updates on buffer change without save
- Location: tests/e2e.spec.ts:101:1

# Error details

```
Error: page.evaluate: SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - generic [ref=e4]: connected
    - button "Save" [ref=e5] [cursor=pointer]
  - generic [ref=e6]:
    - generic [ref=e10]:
      - generic:
        - textbox "Terminal input"
    - iframe [ref=e51]:
      
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { execSync, execFileSync } from 'node:child_process';
  3   | import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
  4   | import { join } from 'node:path';
  5   | import { tmpdir } from 'node:os';
  6   | 
  7   | const APP_URL = 'http://localhost:3141';
  8   | const SOCKET_PATH = '/tmp/pandoc-nvim-preview/nvim.sock';
  9   | 
  10  | // Create a disposable temp file with seed content for each test
  11  | function seedTempFile(name: string, content: string): string {
  12  |   const dir = mkdtempSync(join(tmpdir(), `pnp-${name}-`));
  13  |   const path = join(dir, 'doc.md');
  14  |   writeFileSync(path, content, 'utf-8');
  15  |   return path;
  16  | }
  17  | 
  18  | function nvimRemoteExpr(expr: string): string {
  19  |   try {
  20  |     return execFileSync('nvim', ['--server', SOCKET_PATH, '--remote-expr', expr], {
  21  |       encoding: 'utf-8',
  22  |       timeout: 5000,
  23  |     }).trim();
  24  |   } catch {
  25  |     return '';
  26  |   }
  27  | }
  28  | 
  29  | function getProcessTree(): string[] {
  30  |   try {
  31  |     const out = execSync('ps aux', { encoding: 'utf-8', timeout: 3000 });
  32  |     return out.split('\n').filter((l) => l.includes('nvim'));
  33  |   } catch {
  34  |     return [];
  35  |   }
  36  | }
  37  | 
  38  | function readFile(path: string): string {
  39  |   try {
  40  |     return readFileSync(path, 'utf-8');
  41  |   } catch {
  42  |     return '';
  43  |   }
  44  | }
  45  | 
  46  | async function openFileInServer(page: any, filePath: string) {
  47  |   await page.goto(APP_URL);
  48  |   await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 15000 });
  49  |   // Use the API to switch the file
> 50  |   const res = await page.evaluate(async (path: string) => {
      |                          ^ Error: page.evaluate: SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
  51  |     const r = await fetch('/api/open-file', {
  52  |       method: 'POST',
  53  |       headers: { 'Content-Type': 'application/json' },
  54  |       body: JSON.stringify({ filePath: path }),
  55  |     });
  56  |     return r.json();
  57  |   }, filePath);
  58  |   expect(res.ok).toBe(true);
  59  |   await page.waitForTimeout(2000); // let nvim reload
  60  |   await page.reload();
  61  |   await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 15000 });
  62  | }
  63  | 
  64  | // RED: Terminal pane shows nvim content without requiring keystrokes
  65  | test('terminal pane shows nvim on initial load', async ({ page }) => {
  66  |   await page.goto(APP_URL);
  67  |   await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
  68  | 
  69  |   // nvim should have rendered its startup screen into xterm.js DOM
  70  |   // Without any keystrokes, the terminal should contain text nodes
  71  |   await page.waitForTimeout(2000);
  72  | 
  73  |   const hasText = await page.evaluate(() => {
  74  |     const rows = document.querySelector('.xterm-rows');
  75  |     if (!rows) return false;
  76  |     return rows.textContent !== null && rows.textContent.trim().length > 0;
  77  |   });
  78  | 
  79  |   expect(hasText).toBe(true);
  80  | });
  81  | 
  82  | // RED: Preview shows rendered content on initial load, before any keystrokes
  83  | test('preview shows content on initial load without typing', async ({ page }) => {
  84  |   await page.goto(APP_URL);
  85  |   await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
  86  | 
  87  |   await page.waitForTimeout(3000);
  88  | 
  89  |   const preview = page.frameLocator('[data-testid="preview-frame"]');
  90  | 
  91  |   await expect(preview.locator('h1').first()).toContainText('Test Document', {
  92  |     timeout: 5000,
  93  |   });
  94  | 
  95  |   await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached({
  96  |     timeout: 5000,
  97  |   });
  98  | });
  99  | 
  100 | // RED: Preview updates on buffer change without explicit :w or save
  101 | test('preview updates on buffer change without save', async ({ page }) => {
  102 |   const f = seedTempFile('auto-update', '# Starting Header\n\nSome text.\n');
  103 |   await openFileInServer(page, f);
  104 | 
  105 |   await page.getByTestId('terminal').click();
  106 |   await page.keyboard.type('i# Auto Update Header');
  107 |   await page.keyboard.press('Escape');
  108 | 
  109 |   const preview = page.frameLocator('[data-testid="preview-frame"]');
  110 |   await expect(preview.locator('h1').last()).toContainText('Auto Update Header', {
  111 |     timeout: 5000,
  112 |   });
  113 | });
  114 | 
  115 | // Test: App starts real nvim in terminal pane
  116 | test('app starts real nvim in terminal pane', async ({ page }) => {
  117 |   await page.goto(APP_URL);
  118 | 
  119 |   await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
  120 |   await expect(page.getByTestId('preview')).toBeVisible();
  121 | 
  122 |   const proc = getProcessTree();
  123 |   const nvimProc = proc.filter((l) => !l.includes('[nvim]'));
  124 |   expect(nvimProc.length).toBeGreaterThan(0);
  125 | 
  126 |   const nvimLines = nvimProc.join(' ');
  127 |   expect(nvimLines).toContain('--listen');
  128 |   expect(nvimLines).not.toContain('--headless');
  129 | 
  130 |   await expect(
  131 |     page.locator('[data-testid="terminal"][data-active="true"]'),
  132 |   ).toBeAttached({ timeout: 5000 });
  133 | });
  134 | 
  135 | // Test: Keyboard input reaches real nvim buffer AND writes to disk
  136 | test('keyboard input reaches nvim buffer and persists to file', async ({ page }) => {
  137 |   const f = seedTempFile('kb-input', '# Start\n\n');
  138 |   await openFileInServer(page, f);
  139 | 
  140 |   await page.getByTestId('terminal').click();
  141 |   await page.keyboard.type('iNEW_CONTENT_FROM_KEYBOARD');
  142 |   await page.keyboard.press('Escape');
  143 | 
  144 |   // Save via nvim's remote-send
  145 |   await page.evaluate(async () => {
  146 |     await fetch('/api/save', { method: 'POST' });
  147 |   });
  148 |   await page.waitForTimeout(500);
  149 | 
  150 |   const diskContent = readFile(f);
```