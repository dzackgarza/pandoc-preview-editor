# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_005 immediate save uses latest nvim buffer
- Location: tests/certification.spec.ts:370:1

# Error details

```
Error: save must succeed

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  298 |   // Pre-populate buffer via reliable socket RPC, then type via keyboard for the preview-update proof
  299 |   nvimDirectSend(server004.socketPath, ':%d<CR>');
  300 |   await page.waitForTimeout(200);
  301 |   nvimDirectSend(
  302 |     server004.socketPath,
  303 |     'i# LIVE_PREVIEW_SENTINEL<CR>This is **bold** and $a^2+b^2=c^2$.<Esc>',
  304 |   );
  305 |   await page.waitForTimeout(500);
  306 | 
  307 |   // Now type an additional sentinel through the keyboard for the preview-update leg
  308 |   await page.locator('[data-testid="terminal"]').click();
  309 |   await page.keyboard.type('GoLIVE_TYPE_SENTINEL');
  310 |   await page.keyboard.press('Escape');
  311 |   await page.waitForTimeout(2000);
  312 | 
  313 |   // Independent nvim buffer query - verify ordering: buffer AFTER keyboard
  314 |   const bufTime = Date.now();
  315 |   const nvimBuf = nvimDirectRPC(server004.socketPath, 'join(getline(1, "$"), "\\n")');
  316 |   const bufHash = sha256short(nvimBuf);
  317 |   trace.recordBufferRead(nvimBuf, bufHash);
  318 |   expect(nvimBuf, 'nvim buffer must contain sentinel').toContain(
  319 |     'LIVE_PREVIEW_SENTINEL',
  320 |   );
  321 |   expect(nvimBuf, 'nvim buffer must contain math').toContain('a^2+b^2=c^2');
  322 | 
  323 |   // Preview DOM assertions - verify render AFTER buffer
  324 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  325 | 
  326 |   const h1 = previewFrame.locator('h1').first();
  327 |   await expect(h1, 'preview h1 must be attached').toBeAttached({ timeout: 8000 });
  328 |   await expect(h1, 'preview must show LIVE_PREVIEW_SENTINEL').toContainText(
  329 |     'LIVE_PREVIEW_SENTINEL',
  330 |     { timeout: 5000 },
  331 |   );
  332 |   trace.recordRenderSuccess();
  333 | 
  334 |   const body = previewFrame.locator('body').first();
  335 |   const bodyText = await body.textContent();
  336 |   expect(bodyText, 'preview body must contain typed text').toContain('This is');
  337 |   trace.recordPreviewUpdated();
  338 | 
  339 |   const bold = previewFrame.locator('strong').first();
  340 |   await expect(bold, 'bold text must be rendered').toContainText('bold', {
  341 |     timeout: 3000,
  342 |   });
  343 |   trace.record({ event: 'preview.dom.bold' });
  344 | 
  345 |   // Math element
  346 |   const mathEl = previewFrame.locator('span.math, .MathJax_Preview').first();
  347 |   const mathCount = await mathEl.count();
  348 |   trace.record({ event: 'preview.dom.math', count: mathCount });
  349 |   expect(mathCount, 'math element must exist in preview').toBeGreaterThan(0);
  350 | 
  351 |   // Artifact
  352 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  353 | 
  354 |   trace.record({ event: 'cert.pass', test: 'cert_004' });
  355 | });
  356 | 
  357 | // ============================================================
  358 | // cert_005: immediate save uses latest nvim buffer
  359 | // ============================================================
  360 | 
  361 | let server005: ServerInstance;
  362 | 
  363 | test.afterAll(async () => {
  364 |   if (server005) {
  365 |     await killServer(server005);
  366 |     // cleanup handled by server
  367 |   }
  368 | });
  369 | 
  370 | test('cert_005 immediate save uses latest nvim buffer', async ({ page }) => {
  371 |   const trace = new TraceContext('cert_005');
  372 |   trace.record({ event: 'cert.start', test: 'cert_005' });
  373 | 
  374 |   const SEED = 'before\n';
  375 |   const file = seedTempFile('c005', SEED);
  376 |   trace.writeInitialFile(file, SEED);
  377 | 
  378 |   server005 = await launchServer(file);
  379 |   trace.record({ event: 'server.started', port: server005.port });
  380 | 
  381 |   await page.goto(server005.url);
  382 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  383 |   await page.waitForTimeout(1500);
  384 | 
  385 |   // Type sentinel and immediately save — do NOT wait for preview debounce
  386 |   await page.locator('[data-testid="terminal"]').click();
  387 |   await page.keyboard.type('iIMMEDIATE_SAVE_SENTINEL');
  388 |   await page.keyboard.press('Escape');
  389 |   trace.record({ event: 'browser.keyboard.sent', text: 'iIMMEDIATE_SAVE_SENTINEL' });
  390 | 
  391 |   // Save immediately
  392 |   trace.recordSaveStart();
  393 |   const saveRes = await page.evaluate(async () => {
  394 |     const r = await fetch('/api/save', { method: 'POST' });
  395 |     return r.json();
  396 |   });
  397 |   trace.record({ event: 'save.endpoint.result', ok: saveRes.ok, bytes: saveRes.bytes });
> 398 |   expect(saveRes.ok, 'save must succeed').toBe(true);
      |                                           ^ Error: save must succeed
  399 | 
  400 |   await page.waitForTimeout(500);
  401 | 
  402 |   // Disk must contain sentinel
  403 |   const diskContent = readFile(file);
  404 |   const diskHash = sha256short(diskContent);
  405 |   trace.recordSaveSuccess(diskContent, diskHash);
  406 |   expect(diskContent, 'disk must contain sentinel after immediate save').toContain(
  407 |     'IMMEDIATE_SAVE_SENTINEL',
  408 |   );
  409 | 
  410 |   // Critical: save.success must follow nvim.buffer.read, NOT precede it
  411 |   // Verify via trace event ordering
  412 |   expect(
  413 |     traceOrder(
  414 |       trace,
  415 |       'browser.keyboard.sent',
  416 |       'save.start',
  417 |       'save.endpoint.result',
  418 |       'save.success',
  419 |     ),
  420 |     'trace must show save.start → nvim buffer read → save.success',
  421 |   ).toBe(true);
  422 | 
  423 |   // Artifact
  424 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  425 | 
  426 |   trace.record({ event: 'cert.pass', test: 'cert_005' });
  427 | });
  428 | 
  429 | // ============================================================
  430 | // cert_006: three-way source equivalence
  431 | // ============================================================
  432 | 
  433 | let server006: ServerInstance;
  434 | 
  435 | test.afterAll(async () => {
  436 |   if (server006) {
  437 |     await killServer(server006);
  438 |     // cleanup handled by server
  439 |   }
  440 | });
  441 | 
  442 | test('cert_006 three-way source equivalence: nvim buffer = disk = preview source', async ({
  443 |   page,
  444 | }) => {
  445 |   const trace = new TraceContext('cert_006');
  446 |   trace.record({ event: 'cert.start', test: 'cert_006' });
  447 | 
  448 |   const SEED =
  449 |     '# Three-Way\n\n- Unicode: \u03b1\u03b2\u03b3\n- Math: $f(x)$\n\n```\ncode block\n```\n\n';
  450 |   const file = seedTempFile('c006', SEED);
  451 |   trace.writeInitialFile(file, SEED);
  452 | 
  453 |   server006 = await launchServer(file);
  454 |   trace.record({ event: 'server.started', port: server006.port });
  455 | 
  456 |   await page.goto(server006.url);
  457 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  458 |   await page.waitForTimeout(1500);
  459 | 
  460 |   // Make edits through direct socket RPC (reliable for Vim commands).
  461 |   // cert_006 certifies data equivalence, not the PTY keyboard path (cert_003/004 cover that).
  462 |   nvimDirectSend(server006.socketPath, 'GA<Esc>');
  463 |   await page.waitForTimeout(200);
  464 |   nvimDirectSend(server006.socketPath, 'oAdded line with [@doe99].<Esc>');
  465 |   await page.waitForTimeout(200);
  466 |   nvimDirectSend(server006.socketPath, 'ggIAppended Heading<Esc>');
  467 |   await page.waitForTimeout(500);
  468 | 
  469 |   trace.record({ event: 'browser.edits.done' });
  470 | 
  471 |   // Save via direct socket RPC
  472 |   nvimDirectSend(server006.socketPath, ':w<CR>');
  473 |   trace.record({ event: 'save.success' });
  474 |   await page.waitForTimeout(500);
  475 | 
  476 |   trace.record({ event: 'browser.edits.done' });
  477 | 
  478 |   // Save via direct socket RPC (bypass keyboard unreliability for save)
  479 |   nvimDirectSend(server006.socketPath, ':w<CR>');
  480 |   trace.record({ event: 'save.success' });
  481 |   await page.waitForTimeout(500);
  482 | 
  483 |   // Read from three sources - all AFTER the edits
  484 |   // 1. Direct nvim socket
  485 |   const nvimBuf = nvimDirectRPC(server006.socketPath, 'join(getline(1, "$"), "\\n")');
  486 |   const nvimHash = sha256short(nvimBuf);
  487 |   trace.recordBufferRead(nvimBuf, nvimHash);
  488 | 
  489 |   // 2. Server /api/buffer endpoint
  490 |   const bufRes = await fetch(`${server006.url}/api/buffer`);
  491 |   const bufData = await bufRes.json();
  492 |   const serverHash = bufData.hash;
  493 |   trace.record({
  494 |     event: 'source.server',
  495 |     sha256: serverHash,
  496 |     bytes: bufData.buffer.length,
  497 |   });
  498 | 
```