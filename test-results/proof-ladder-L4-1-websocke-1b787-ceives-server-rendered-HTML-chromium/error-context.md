# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: proof-ladder.spec.ts >> L4.1 websocket_preview_delivery — iframe receives server-rendered HTML
- Location: tests/proof-ladder.spec.ts:256:1

# Error details

```
Error: iframe must contain heading after WS delivery

expect(locator).toBeAttached() failed

Locator: locator('[data-testid="preview-frame"]').contentFrame().locator('h1').first()
Expected: attached
Timeout: 8000ms
Error: element(s) not found

Call log:
  - iframe must contain heading after WS delivery with timeout 8000ms
  - waiting for locator('[data-testid="preview-frame"]').contentFrame().locator('h1').first()

```

# Test source

```ts
  168 | let serverL2: ServerInstance;
  169 | 
  170 | test.afterAll(async () => {
  171 |   if (serverL2) {
  172 |     await killServer(serverL2);
  173 |     // cleanup handled by server
  174 |   }
  175 | });
  176 | 
  177 | test('L2.1 server_starts_nvim_and_status_reports_pid_socket', async () => {
  178 |   const file = seedTempFile('l21', '# L2 Server\n\nStatus test.\n');
  179 |   serverL2 = await launchServer(file);
  180 | 
  181 |   const res = await fetch(`${serverL2.url}/api/status`);
  182 |   expect(res.status).toBe(200);
  183 |   const status = await res.json();
  184 | 
  185 |   expect(status.pid, '/api/status must report pid > 0').toBeGreaterThan(0);
  186 |   expect(status.socket, '/api/status must report correct socket').toBe(
  187 |     serverL2.socketPath,
  188 |   );
  189 |   expect(status.file, '/api/status must report file path').toBe(file);
  190 | 
  191 |   const ps = spawnSync('ps', ['-p', String(status.pid), '-o', 'pid,comm'], {
  192 |     encoding: 'utf-8',
  193 |     timeout: 3000,
  194 |   });
  195 |   expect(ps.stdout, 'ps must confirm nvim process').toContain('nvim');
  196 | });
  197 | 
  198 | test('L2.2 server_buffer_endpoint_reads_nvim_buffer', async () => {
  199 |   const file = seedTempFile('l22', '# L2 Buffer\n\nEndpoint test.\n');
  200 |   serverL2 = await launchServer(file);
  201 | 
  202 |   const res = await fetch(`${serverL2.url}/api/buffer`);
  203 |   expect(res.status).toBe(200);
  204 |   const data = await res.json();
  205 | 
  206 |   expect(data.buffer, '/api/buffer must contain seed heading').toContain('L2 Buffer');
  207 |   expect(data.buffer, '/api/buffer must contain seed body').toContain('Endpoint test');
  208 |   expect(data.hash, '/api/buffer must include non-empty hash').toBeTruthy();
  209 |   expect(typeof data.hash).toBe('string');
  210 |   expect(data.socketPath, '/api/buffer must report socket path').toBe(
  211 |     serverL2.socketPath,
  212 |   );
  213 | });
  214 | 
  215 | // ============================================================
  216 | // LAYER 3: Renderer facts — no nvim, no browser
  217 | // ============================================================
  218 | 
  219 | test('L3.1 pandoc_renders_markdown_heading_without_nvim', async () => {
  220 |   const md = '# The Title\n\nSome text. $E=mc^2$';
  221 |   const result = pandocRender(md);
  222 | 
  223 |   expect(result.status, `pandoc exit code must be 0; stderr=${result.stderr}`).toBe(0);
  224 |   expect(result.stdout, 'pandoc output must contain heading text').toContain(
  225 |     'The Title',
  226 |   );
  227 |   expect(result.stdout, 'pandoc must render math as span.math.inline').toMatch(
  228 |     /<span class="math inline">/,
  229 |   );
  230 | });
  231 | 
  232 | test('L3.2 pandoc renders citation as span with data-cites', async () => {
  233 |   const md = 'See @doe99.';
  234 |   const result = pandocRender(md);
  235 | 
  236 |   // --citeproc with no bibliography: pandoc exits 0 but emits a warning comment
  237 |   expect(result.stdout, 'pandoc must include citation author').toContain('doe99');
  238 |   expect(result.stdout, 'pandoc must render citation span').toMatch(
  239 |     /<span class="citation"[^>]*data-cites="doe99"/,
  240 |   );
  241 | });
  242 | 
  243 | // ============================================================
  244 | // LAYER 4: WebSocket / preview delivery
  245 | // ============================================================
  246 | 
  247 | let serverL4: ServerInstance;
  248 | 
  249 | test.afterAll(async () => {
  250 |   if (serverL4) {
  251 |     await killServer(serverL4);
  252 |     // cleanup handled by server
  253 |   }
  254 | });
  255 | 
  256 | test('L4.1 websocket_preview_delivery — iframe receives server-rendered HTML', async ({
  257 |   page,
  258 | }) => {
  259 |   const file = seedTempFile('l41', '# WS Delivery\n\n**bold** text.\n');
  260 |   serverL4 = await launchServer(file);
  261 | 
  262 |   await page.goto(serverL4.url);
  263 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  264 |   await page.waitForTimeout(2000);
  265 | 
  266 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  267 |   const h1 = previewFrame.locator('h1').first();
> 268 |   await expect(h1, 'iframe must contain heading after WS delivery').toBeAttached({
      |                                                                     ^ Error: iframe must contain heading after WS delivery
  269 |     timeout: 8000,
  270 |   });
  271 | 
  272 |   const text = await h1.textContent();
  273 |   expect(text, 'h1 text must match seed file heading').toContain('WS Delivery');
  274 | 
  275 |   const bold = previewFrame.locator('strong').first();
  276 |   await expect(bold, 'bold text must appear via WS delivery').toContainText('bold', {
  277 |     timeout: 3000,
  278 |   });
  279 | });
  280 | 
  281 | // ============================================================
  282 | // LAYER 5: Terminal input reaches nvim
  283 | // ============================================================
  284 | 
  285 | let serverL5: ServerInstance;
  286 | 
  287 | test.afterAll(async () => {
  288 |   if (serverL5) {
  289 |     await killServer(serverL5);
  290 |     // cleanup handled by server
  291 |   }
  292 | });
  293 | 
  294 | test('L5.1 xterm_keyboard_input_changes_nvim_buffer', async ({ page }) => {
  295 |   const file = seedTempFile('l51', '# L5 Type\n\n');
  296 |   serverL5 = await launchServer(file);
  297 | 
  298 |   await page.goto(serverL5.url);
  299 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  300 |   await page.waitForTimeout(1500);
  301 | 
  302 |   // Type into xterm.js terminal, which relays through PTY to nvim
  303 |   await page.locator('[data-testid="terminal"]').click();
  304 |   await page.keyboard.type('iL5_SENTINEL_CHARLIE');
  305 |   await page.keyboard.press('Escape');
  306 |   await page.waitForTimeout(1000);
  307 | 
  308 |   // Query nvim via socket RPC — external fact, NOT internal API
  309 |   const buf = nvimDirectRPC(serverL5.socketPath, 'join(getline(1, "$"), "\\n")');
  310 |   expect(buf, 'nvim buffer must contain typed sentinel').toContain(
  311 |     'L5_SENTINEL_CHARLIE',
  312 |   );
  313 | });
  314 | 
  315 | // ============================================================
  316 | // LAYER 6: Full product contract
  317 | // ============================================================
  318 | 
  319 | let serverL6: ServerInstance;
  320 | 
  321 | test.afterAll(async () => {
  322 |   if (serverL6) {
  323 |     await killServer(serverL6);
  324 |     // cleanup handled by server
  325 |   }
  326 | });
  327 | 
  328 | test('L6.1 full_type_preview_save_contract — type, preview, save, disk', async ({
  329 |   page,
  330 | }) => {
  331 |   const file = seedTempFile('l61', '# Contract Start\n\nInitial text.\n');
  332 |   serverL6 = await launchServer(file);
  333 | 
  334 |   await page.goto(serverL6.url);
  335 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  336 |   await page.waitForTimeout(1500);
  337 | 
  338 |   // Assert initial preview shows seed content
  339 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  340 |   await expect(
  341 |     previewFrame.locator('body'),
  342 |     'preview must show initial heading',
  343 |   ).toContainText('Contract Start', { timeout: 5000 });
  344 | 
  345 |   // Type new content into nvim via terminal
  346 |   await page.locator('[data-testid="terminal"]').click();
  347 |   await page.keyboard.type('iL6_CONTRACT_FINAL');
  348 |   await page.keyboard.press('Escape');
  349 |   await page.waitForTimeout(2000);
  350 | 
  351 |   // Assert preview updated with sentinel
  352 |   await expect(
  353 |     previewFrame.locator('body'),
  354 |     'preview must update with typed sentinel',
  355 |   ).toContainText('L6_CONTRACT_FINAL', { timeout: 8000 });
  356 | 
  357 |   // Save via API
  358 |   const saveRes = await page.evaluate(async () => {
  359 |     const r = await fetch('/api/save', { method: 'POST' });
  360 |     return r.json();
  361 |   });
  362 |   expect(saveRes.ok, '/api/save must return ok: true').toBe(true);
  363 |   await page.waitForTimeout(500);
  364 | 
  365 |   // Assert file on disk contains both seed text and typed sentinel
  366 |   const diskContent = readFile(file);
  367 |   expect(diskContent, 'disk must contain sentinel').toContain('L6_CONTRACT_FINAL');
  368 |   expect(diskContent, 'disk must contain initial text').toContain('Initial text');
```