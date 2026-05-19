# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: proof-ladder.spec.ts >> L6.1 full_type_preview_save_contract — type, preview, save, disk
- Location: tests/proof-ladder.spec.ts:330:1

# Error details

```
Error: preview must update with typed sentinel

expect(locator).toContainText(expected) failed

Locator: locator('[data-testid="preview-frame"]').contentFrame().locator('body')
Timeout: 8000ms
- Expected substring  - 1
+ Received string     + 5

- L6_CONTRACT_FINAL
+
+ before
+
+
+

Call log:
  - preview must update with typed sentinel with timeout 8000ms
  - waiting for locator('[data-testid="preview-frame"]').contentFrame().locator('body')
    4 × locator resolved to <body>…</body>
      - unexpected value "
Contract Start
Initial text.


"
    15 × locator resolved to <body>…</body>
       - unexpected value "
before


"

```

```yaml
- paragraph: before
```

# Test source

```ts
  257 | 
  258 | test('L4.1 websocket_preview_delivery — iframe receives server-rendered HTML', async ({
  259 |   page,
  260 | }) => {
  261 |   const file = seedTempFile('l41', '# WS Delivery\n\n**bold** text.\n');
  262 |   serverL4 = await launchServer(file);
  263 | 
  264 |   await page.goto(serverL4.url);
  265 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  266 |   await page.waitForTimeout(2000);
  267 | 
  268 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  269 |   const h1 = previewFrame.locator('h1').first();
  270 |   await expect(h1, 'iframe must contain heading after WS delivery').toBeAttached({
  271 |     timeout: 8000,
  272 |   });
  273 | 
  274 |   const text = await h1.textContent();
  275 |   expect(text, 'h1 text must match seed file heading').toContain('WS Delivery');
  276 | 
  277 |   const bold = previewFrame.locator('strong').first();
  278 |   await expect(bold, 'bold text must appear via WS delivery').toContainText('bold', {
  279 |     timeout: 3000,
  280 |   });
  281 | });
  282 | 
  283 | // ============================================================
  284 | // LAYER 5: Terminal input reaches nvim
  285 | // ============================================================
  286 | 
  287 | let serverL5: ServerInstance;
  288 | 
  289 | test.afterAll(async () => {
  290 |   if (serverL5) {
  291 |     await killServer(serverL5);
  292 |     cleanServerArtifacts(serverL5);
  293 |   }
  294 | });
  295 | 
  296 | test('L5.1 xterm_keyboard_input_changes_nvim_buffer', async ({ page }) => {
  297 |   const file = seedTempFile('l51', '# L5 Type\n\n');
  298 |   serverL5 = await launchServer(file);
  299 | 
  300 |   await page.goto(serverL5.url);
  301 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  302 |   await page.waitForTimeout(1500);
  303 | 
  304 |   // Type into xterm.js terminal, which relays through PTY to nvim
  305 |   await page.locator('[data-testid="terminal"]').click();
  306 |   await page.keyboard.type('iL5_SENTINEL_CHARLIE');
  307 |   await page.keyboard.press('Escape');
  308 |   await page.waitForTimeout(1000);
  309 | 
  310 |   // Query nvim via socket RPC — external fact, NOT internal API
  311 |   const buf = nvimDirectRPC(serverL5.socketPath, 'join(getline(1, "$"), "\\n")');
  312 |   expect(buf, 'nvim buffer must contain typed sentinel').toContain(
  313 |     'L5_SENTINEL_CHARLIE',
  314 |   );
  315 | });
  316 | 
  317 | // ============================================================
  318 | // LAYER 6: Full product contract
  319 | // ============================================================
  320 | 
  321 | let serverL6: ServerInstance;
  322 | 
  323 | test.afterAll(async () => {
  324 |   if (serverL6) {
  325 |     await killServer(serverL6);
  326 |     cleanServerArtifacts(serverL6);
  327 |   }
  328 | });
  329 | 
  330 | test('L6.1 full_type_preview_save_contract — type, preview, save, disk', async ({
  331 |   page,
  332 | }) => {
  333 |   const file = seedTempFile('l61', '# Contract Start\n\nInitial text.\n');
  334 |   serverL6 = await launchServer(file);
  335 | 
  336 |   await page.goto(serverL6.url);
  337 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  338 |   await page.waitForTimeout(1500);
  339 | 
  340 |   // Assert initial preview shows seed content
  341 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  342 |   await expect(
  343 |     previewFrame.locator('body'),
  344 |     'preview must show initial heading',
  345 |   ).toContainText('Contract Start', { timeout: 5000 });
  346 | 
  347 |   // Type new content into nvim via terminal
  348 |   await page.locator('[data-testid="terminal"]').click();
  349 |   await page.keyboard.type('iL6_CONTRACT_FINAL');
  350 |   await page.keyboard.press('Escape');
  351 |   await page.waitForTimeout(2000);
  352 | 
  353 |   // Assert preview updated with sentinel
  354 |   await expect(
  355 |     previewFrame.locator('body'),
  356 |     'preview must update with typed sentinel',
> 357 |   ).toContainText('L6_CONTRACT_FINAL', { timeout: 8000 });
      |     ^ Error: preview must update with typed sentinel
  358 | 
  359 |   // Save via API
  360 |   const saveRes = await page.evaluate(async () => {
  361 |     const r = await fetch('/api/save', { method: 'POST' });
  362 |     return r.json();
  363 |   });
  364 |   expect(saveRes.ok, '/api/save must return ok: true').toBe(true);
  365 |   await page.waitForTimeout(500);
  366 | 
  367 |   // Assert file on disk contains both seed text and typed sentinel
  368 |   const diskContent = readFile(file);
  369 |   expect(diskContent, 'disk must contain sentinel').toContain('L6_CONTRACT_FINAL');
  370 |   expect(diskContent, 'disk must contain initial text').toContain('Initial text');
  371 | });
  372 | 
```