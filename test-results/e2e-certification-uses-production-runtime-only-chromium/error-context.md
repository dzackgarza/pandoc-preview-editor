# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e.spec.ts >> certification uses production runtime only
- Location: tests/e2e.spec.ts:248:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "/tmp/pandoc-nvim-preview/nvim.sock"
Received: "/tmp/pandoc-nvim-preview/nvim-92268.sock"
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
  164 |   await page.keyboard.press('Enter');
  165 |   await page.keyboard.press('Enter');
  166 |   await page.keyboard.type('Let $E=mc^2$');
  167 |   await page.keyboard.press('.');
  168 |   await page.keyboard.press('Escape');
  169 | 
  170 |   await page.waitForTimeout(1000);
  171 | 
  172 |   // Save to disk
  173 |   await page.evaluate(async () => {
  174 |     await fetch('/api/save', { method: 'POST' });
  175 |   });
  176 |   await page.waitForTimeout(500);
  177 | 
  178 |   // Assert file on disk
  179 |   const diskContent = readFile(f);
  180 |   expect(diskContent).toContain('Theorem');
  181 |   expect(diskContent).toContain('E=mc^2');
  182 | 
  183 |   // Assert preview DOM
  184 |   const preview = page.frameLocator('[data-testid="preview-frame"]');
  185 |   await expect(preview.locator('h1').last()).toContainText('Theorem');
  186 |   await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached({
  187 |     timeout: 5000,
  188 |   });
  189 | });
  190 | 
  191 | // Test: Save uses live nvim buffer, not stale cache
  192 | test('save uses live nvim buffer not stale cache', async ({ page }) => {
  193 |   const f = seedTempFile('save-live', '# Before\n\n');
  194 |   await openFileInServer(page, f);
  195 | 
  196 |   await page.getByTestId('terminal').click();
  197 |   await page.keyboard.type('iAFTER_SAVE_SENTINEL_X');
  198 |   await page.keyboard.press('Escape');
  199 | 
  200 |   await page.evaluate(async () => {
  201 |     await fetch('/api/save', { method: 'POST' });
  202 |   });
  203 |   await page.waitForTimeout(500);
  204 | 
  205 |   const diskContent = readFile(f);
  206 |   expect(diskContent).toContain('AFTER_SAVE_SENTINEL_X');
  207 | });
  208 | 
  209 | // Test: Pandoc math and citations render in preview, file has source
  210 | test('pandoc math and citations render and file contains source', async ({ page }) => {
  211 |   const f = seedTempFile('math-cite', '# Cites\n\n');
  212 |   await openFileInServer(page, f);
  213 | 
  214 |   await page.getByTestId('terminal').click();
  215 |   await page.keyboard.type('iSee @doe99. Also $x^2+y^2=z^2$');
  216 |   await page.keyboard.press('.');
  217 |   await page.keyboard.press('Escape');
  218 | 
  219 |   await page.waitForTimeout(1000);
  220 | 
  221 |   await page.evaluate(async () => {
  222 |     await fetch('/api/save', { method: 'POST' });
  223 |   });
  224 |   await page.waitForTimeout(500);
  225 | 
  226 |   const diskContent = readFile(f);
  227 |   expect(diskContent).toContain('@doe99');
  228 |   expect(diskContent).toContain('x^2+y^2=z^2');
  229 | 
  230 |   const preview = page.frameLocator('[data-testid="preview-frame"]');
  231 |   await expect(preview.locator('body')).toContainText('doe99');
  232 |   await expect(preview.locator('.MathJax, .katex, math, .math').first()).toBeAttached({
  233 |     timeout: 5000,
  234 |   });
  235 | });
  236 | 
  237 | // Test: Invalid nvim path fails before active state
  238 | test('invalid nvim path fails before active state', async ({ page }) => {
  239 |   await page.goto(APP_URL);
  240 |   await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
  241 | 
  242 |   await expect(page.getByTestId('status')).not.toContainText('error', {
  243 |     timeout: 5000,
  244 |   });
  245 | });
  246 | 
  247 | // Test: Certification uses production runtime only
  248 | test('certification uses production runtime only', async ({ page }) => {
  249 |   await page.goto(APP_URL);
  250 |   await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 10000 });
  251 | 
  252 |   const proc = getProcessTree();
  253 |   expect(proc.some((l) => !l.includes('[nvim]'))).toBeTruthy();
  254 | 
  255 |   await expect(
  256 |     page.locator('[data-testid="terminal"][data-active="true"]'),
  257 |   ).toBeAttached({ timeout: 5000 });
  258 | 
  259 |   await expect(page.locator('[data-testid="preview-frame"]')).toBeAttached();
  260 | 
  261 |   const statusRes = await fetch(`${APP_URL}/api/status`);
  262 |   const statusData = await statusRes.json();
  263 |   expect(statusData.pid).toBeGreaterThan(0);
> 264 |   expect(statusData.socket).toBe(SOCKET_PATH);
      |                             ^ Error: expect(received).toBe(expected) // Object.is equality
  265 | });
  266 | 
```