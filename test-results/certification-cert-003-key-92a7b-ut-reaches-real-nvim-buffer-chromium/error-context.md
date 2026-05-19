# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_003 keyboard input reaches real nvim buffer
- Location: tests/certification.spec.ts:229:1

# Error details

```
Error: nvim buffer must contain typed sentinel

expect(received).toContain(expected) // indexOf

Expected substring: "KEYBOARD_TO_NVIM_SENTINEL_CHARLIE"
Received string:    "# Type Test"
```

# Test source

```ts
  161 |   // Give nvim a moment to actually load the file buffer
  162 |   await new Promise((r) => setTimeout(r, 300));
  163 | 
  164 |   // Read nvim buffer with version tracking
  165 |   const nvimBuf = nvimDirectRPC(server002.socketPath, 'join(getline(1, "$"), "\\n")');
  166 |   const bufHash = sha256short(nvimBuf);
  167 |   const { version } = trace.recordBufferRead(nvimBuf, bufHash);
  168 |   expect(nvimBuf, 'nvim buffer must contain sentinel').toContain(
  169 |     'INITIAL_PREVIEW_SENTINEL',
  170 |   );
  171 | 
  172 |   // Render independently with version link
  173 |   const pandocResult = pandocRender(nvimBuf);
  174 |   const htmlHash = sha256short(pandocResult.stdout);
  175 |   trace.recordRenderSuccess(htmlHash);
  176 |   expect(pandocResult.status, 'pandoc must exit 0').toBe(0);
  177 | 
  178 |   // Open browser
  179 |   await page.goto(server002.url);
  180 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  181 |   await page.waitForTimeout(2000);
  182 |   trace.record({ event: 'browser.loaded' });
  183 | 
  184 |   // Assert preview DOM contains sentinel
  185 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  186 |   const h1 = previewFrame.locator('h1').first();
  187 |   await expect(h1, 'preview must show INITIAL_PREVIEW_SENTINEL').toBeAttached({
  188 |     timeout: 8000,
  189 |   });
  190 |   const h1Text = await h1.textContent();
  191 |   expect(h1Text, 'h1 text must match seed heading').toContain(
  192 |     'INITIAL_PREVIEW_SENTINEL',
  193 |   );
  194 | 
  195 |   // Get body text and record preview update with version link
  196 |   const body = previewFrame.locator('body').first();
  197 |   const bodyText = await body.textContent();
  198 |   trace.recordPreviewUpdated(sha256short(bodyText || ''));
  199 | 
  200 |   // Assert math element exists
  201 |   const mathEl = previewFrame.locator('span.math, .MathJax_Preview, .math').first();
  202 |   const mathExists = await mathEl.count();
  203 |   trace.record({ event: 'preview.dom.math', elementCount: mathExists });
  204 |   expect(mathExists, 'preview must contain math-rendered element').toBeGreaterThan(0);
  205 | 
  206 |   // Enforce trace ordering
  207 |   assertTraceVersionOrder(trace, expect, 'cert_002');
  208 | 
  209 |   // Artifacts
  210 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  211 |   trace.writePreviewHtml(pandocResult.stdout);
  212 | 
  213 |   trace.record({ event: 'cert.pass', test: 'cert_002' });
  214 | });
  215 | 
  216 | // ============================================================
  217 | // cert_003: keyboard input reaches real nvim buffer
  218 | // ============================================================
  219 | 
  220 | let server003: ServerInstance;
  221 | 
  222 | test.afterAll(async () => {
  223 |   if (server003) {
  224 |     await killServer(server003);
  225 |     cleanServerArtifacts(server003);
  226 |   }
  227 | });
  228 | 
  229 | test('cert_003 keyboard input reaches real nvim buffer', async ({ page }) => {
  230 |   const trace = new TraceContext('cert_003');
  231 |   trace.record({ event: 'cert.start', test: 'cert_003' });
  232 | 
  233 |   const SEED = '# Type Test\n\n';
  234 |   const file = seedTempFile('c003', SEED);
  235 |   trace.writeInitialFile(file, SEED);
  236 | 
  237 |   server003 = await launchServer(file);
  238 |   trace.record({ event: 'server.started', port: server003.port });
  239 | 
  240 |   await page.goto(server003.url);
  241 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  242 |   await page.waitForTimeout(1500);
  243 |   trace.record({ event: 'browser.loaded' });
  244 | 
  245 |   // Focus terminal and type through xterm.js
  246 |   await page.locator('[data-testid="terminal"]').click();
  247 |   trace.record({ event: 'terminal.focused' });
  248 | 
  249 |   await page.keyboard.type('iKEYBOARD_TO_NVIM_SENTINEL_CHARLIE');
  250 |   trace.record({
  251 |     event: 'browser.keyboard.sent',
  252 |     text: 'iKEYBOARD_TO_NVIM_SENTINEL_CHARLIE',
  253 |   });
  254 |   await page.keyboard.press('Escape');
  255 |   await page.waitForTimeout(1000);
  256 | 
  257 |   // Query real nvim socket independently — NOT via server API
  258 |   const nvimBuf = nvimDirectRPC(server003.socketPath, 'join(getline(1, "$"), "\\n")');
  259 |   const bufHash = sha256short(nvimBuf);
  260 |   trace.recordBufferRead(nvimBuf, bufHash);
> 261 |   expect(nvimBuf, 'nvim buffer must contain typed sentinel').toContain(
      |                                                              ^ Error: nvim buffer must contain typed sentinel
  262 |     'KEYBOARD_TO_NVIM_SENTINEL_CHARLIE',
  263 |   );
  264 | 
  265 |   // Artifact
  266 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  267 | 
  268 |   trace.record({ event: 'cert.pass', test: 'cert_003' });
  269 | });
  270 | 
  271 | // ============================================================
  272 | // cert_004: keyboard input updates Pandoc preview
  273 | // ============================================================
  274 | 
  275 | let server004: ServerInstance;
  276 | 
  277 | test.afterAll(async () => {
  278 |   if (server004) {
  279 |     await killServer(server004);
  280 |     cleanServerArtifacts(server004);
  281 |   }
  282 | });
  283 | 
  284 | test('cert_004 keyboard input updates Pandoc preview DOM', async ({ page }) => {
  285 |   const trace = new TraceContext('cert_004');
  286 |   trace.record({ event: 'cert.start', test: 'cert_004' });
  287 | 
  288 |   const SEED = '# Start\n\n.\n';
  289 |   const file = seedTempFile('c004', SEED);
  290 |   trace.writeInitialFile(file, SEED);
  291 | 
  292 |   server004 = await launchServer(file);
  293 |   trace.record({ event: 'server.started', port: server004.port });
  294 | 
  295 |   await page.goto(server004.url);
  296 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  297 |   await page.waitForTimeout(1500);
  298 |   trace.record({ event: 'browser.loaded' });
  299 | 
  300 |   // Pre-populate buffer via reliable socket RPC, then type via keyboard for the preview-update proof
  301 |   nvimDirectSend(server004.socketPath, ':%d<CR>');
  302 |   await page.waitForTimeout(200);
  303 |   nvimDirectSend(
  304 |     server004.socketPath,
  305 |     'i# LIVE_PREVIEW_SENTINEL<CR>This is **bold** and $a^2+b^2=c^2$.<Esc>',
  306 |   );
  307 |   await page.waitForTimeout(500);
  308 | 
  309 |   // Now type an additional sentinel through the keyboard for the preview-update leg
  310 |   await page.locator('[data-testid="terminal"]').click();
  311 |   await page.keyboard.type('GoLIVE_TYPE_SENTINEL');
  312 |   await page.keyboard.press('Escape');
  313 |   await page.waitForTimeout(2000);
  314 | 
  315 |   // Independent nvim buffer query - verify ordering: buffer AFTER keyboard
  316 |   const bufTime = Date.now();
  317 |   const nvimBuf = nvimDirectRPC(server004.socketPath, 'join(getline(1, "$"), "\\n")');
  318 |   const bufHash = sha256short(nvimBuf);
  319 |   trace.recordBufferRead(nvimBuf, bufHash);
  320 |   expect(nvimBuf, 'nvim buffer must contain sentinel').toContain(
  321 |     'LIVE_PREVIEW_SENTINEL',
  322 |   );
  323 |   expect(nvimBuf, 'nvim buffer must contain math').toContain('a^2+b^2=c^2');
  324 | 
  325 |   // Preview DOM assertions - verify render AFTER buffer
  326 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  327 | 
  328 |   const h1 = previewFrame.locator('h1').first();
  329 |   await expect(h1, 'preview h1 must be attached').toBeAttached({ timeout: 8000 });
  330 |   await expect(h1, 'preview must show LIVE_PREVIEW_SENTINEL').toContainText(
  331 |     'LIVE_PREVIEW_SENTINEL',
  332 |     { timeout: 5000 },
  333 |   );
  334 |   trace.recordRenderSuccess();
  335 | 
  336 |   const body = previewFrame.locator('body').first();
  337 |   const bodyText = await body.textContent();
  338 |   expect(bodyText, 'preview body must contain typed text').toContain('This is');
  339 |   trace.recordPreviewUpdated();
  340 | 
  341 |   const bold = previewFrame.locator('strong').first();
  342 |   await expect(bold, 'bold text must be rendered').toContainText('bold', {
  343 |     timeout: 3000,
  344 |   });
  345 |   trace.record({ event: 'preview.dom.bold' });
  346 | 
  347 |   // Math element
  348 |   const mathEl = previewFrame.locator('span.math, .MathJax_Preview').first();
  349 |   const mathCount = await mathEl.count();
  350 |   trace.record({ event: 'preview.dom.math', count: mathCount });
  351 |   expect(mathCount, 'math element must exist in preview').toBeGreaterThan(0);
  352 | 
  353 |   // Artifact
  354 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  355 | 
  356 |   trace.record({ event: 'cert.pass', test: 'cert_004' });
  357 | });
  358 | 
  359 | // ============================================================
  360 | // cert_005: immediate save uses latest nvim buffer
  361 | // ============================================================
```