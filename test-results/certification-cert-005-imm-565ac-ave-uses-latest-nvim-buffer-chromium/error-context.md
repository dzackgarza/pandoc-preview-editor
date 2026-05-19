# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_005 immediate save uses latest nvim buffer
- Location: tests/certification.spec.ts:372:1

# Error details

```
Error: disk must contain sentinel after immediate save

expect(received).toContain(expected) // indexOf

Expected substring: "IMMEDIATE_SAVE_SENTINEL"
Received string:    "before
"
```

# Test source

```ts
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
  362 | 
  363 | let server005: ServerInstance;
  364 | 
  365 | test.afterAll(async () => {
  366 |   if (server005) {
  367 |     await killServer(server005);
  368 |     cleanServerArtifacts(server005);
  369 |   }
  370 | });
  371 | 
  372 | test('cert_005 immediate save uses latest nvim buffer', async ({ page }) => {
  373 |   const trace = new TraceContext('cert_005');
  374 |   trace.record({ event: 'cert.start', test: 'cert_005' });
  375 | 
  376 |   const SEED = 'before\n';
  377 |   const file = seedTempFile('c005', SEED);
  378 |   trace.writeInitialFile(file, SEED);
  379 | 
  380 |   server005 = await launchServer(file);
  381 |   trace.record({ event: 'server.started', port: server005.port });
  382 | 
  383 |   await page.goto(server005.url);
  384 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  385 |   await page.waitForTimeout(1500);
  386 | 
  387 |   // Type sentinel and immediately save — do NOT wait for preview debounce
  388 |   await page.locator('[data-testid="terminal"]').click();
  389 |   await page.keyboard.type('iIMMEDIATE_SAVE_SENTINEL');
  390 |   await page.keyboard.press('Escape');
  391 |   trace.record({ event: 'browser.keyboard.sent', text: 'iIMMEDIATE_SAVE_SENTINEL' });
  392 | 
  393 |   // Save immediately
  394 |   trace.recordSaveStart();
  395 |   const saveRes = await page.evaluate(async () => {
  396 |     const r = await fetch('/api/save', { method: 'POST' });
  397 |     return r.json();
  398 |   });
  399 |   trace.record({ event: 'save.endpoint.result', ok: saveRes.ok, bytes: saveRes.bytes });
  400 |   expect(saveRes.ok, 'save must succeed').toBe(true);
  401 | 
  402 |   await page.waitForTimeout(500);
  403 | 
  404 |   // Disk must contain sentinel
  405 |   const diskContent = readFile(file);
  406 |   const diskHash = sha256short(diskContent);
  407 |   trace.recordSaveSuccess(diskContent, diskHash);
> 408 |   expect(diskContent, 'disk must contain sentinel after immediate save').toContain(
      |                                                                          ^ Error: disk must contain sentinel after immediate save
  409 |     'IMMEDIATE_SAVE_SENTINEL',
  410 |   );
  411 | 
  412 |   // Critical: save.success must follow nvim.buffer.read, NOT precede it
  413 |   // Verify via trace event ordering
  414 |   expect(
  415 |     traceOrder(
  416 |       trace,
  417 |       'browser.keyboard.sent',
  418 |       'save.start',
  419 |       'save.endpoint.result',
  420 |       'save.success',
  421 |     ),
  422 |     'trace must show save.start → nvim buffer read → save.success',
  423 |   ).toBe(true);
  424 | 
  425 |   // Artifact
  426 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  427 | 
  428 |   trace.record({ event: 'cert.pass', test: 'cert_005' });
  429 | });
  430 | 
  431 | // ============================================================
  432 | // cert_006: three-way source equivalence
  433 | // ============================================================
  434 | 
  435 | let server006: ServerInstance;
  436 | 
  437 | test.afterAll(async () => {
  438 |   if (server006) {
  439 |     await killServer(server006);
  440 |     cleanServerArtifacts(server006);
  441 |   }
  442 | });
  443 | 
  444 | test('cert_006 three-way source equivalence: nvim buffer = disk = preview source', async ({
  445 |   page,
  446 | }) => {
  447 |   const trace = new TraceContext('cert_006');
  448 |   trace.record({ event: 'cert.start', test: 'cert_006' });
  449 | 
  450 |   const SEED =
  451 |     '# Three-Way\n\n- Unicode: \u03b1\u03b2\u03b3\n- Math: $f(x)$\n\n```\ncode block\n```\n\n';
  452 |   const file = seedTempFile('c006', SEED);
  453 |   trace.writeInitialFile(file, SEED);
  454 | 
  455 |   server006 = await launchServer(file);
  456 |   trace.record({ event: 'server.started', port: server006.port });
  457 | 
  458 |   await page.goto(server006.url);
  459 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  460 |   await page.waitForTimeout(1500);
  461 | 
  462 |   // Make edits through direct socket RPC (reliable for Vim commands).
  463 |   // cert_006 certifies data equivalence, not the PTY keyboard path (cert_003/004 cover that).
  464 |   nvimDirectSend(server006.socketPath, 'GA<Esc>');
  465 |   await page.waitForTimeout(200);
  466 |   nvimDirectSend(server006.socketPath, 'oAdded line with [@doe99].<Esc>');
  467 |   await page.waitForTimeout(200);
  468 |   nvimDirectSend(server006.socketPath, 'ggIAppended Heading<Esc>');
  469 |   await page.waitForTimeout(500);
  470 | 
  471 |   trace.record({ event: 'browser.edits.done' });
  472 | 
  473 |   // Save via direct socket RPC
  474 |   nvimDirectSend(server006.socketPath, ':w<CR>');
  475 |   trace.record({ event: 'save.success' });
  476 |   await page.waitForTimeout(500);
  477 | 
  478 |   trace.record({ event: 'browser.edits.done' });
  479 | 
  480 |   // Save via direct socket RPC (bypass keyboard unreliability for save)
  481 |   nvimDirectSend(server006.socketPath, ':w<CR>');
  482 |   trace.record({ event: 'save.success' });
  483 |   await page.waitForTimeout(500);
  484 | 
  485 |   // Read from three sources - all AFTER the edits
  486 |   // 1. Direct nvim socket
  487 |   const nvimBuf = nvimDirectRPC(server006.socketPath, 'join(getline(1, "$"), "\\n")');
  488 |   const nvimHash = sha256short(nvimBuf);
  489 |   trace.recordBufferRead(nvimBuf, nvimHash);
  490 | 
  491 |   // 2. Server /api/buffer endpoint
  492 |   const bufRes = await fetch(`${server006.url}/api/buffer`);
  493 |   const bufData = await bufRes.json();
  494 |   const serverHash = bufData.hash;
  495 |   trace.record({
  496 |     event: 'source.server',
  497 |     sha256: serverHash,
  498 |     bytes: bufData.buffer.length,
  499 |   });
  500 | 
  501 |   // 3. Disk file
  502 |   const diskContent = readFile(file);
  503 |   const diskHash = sha256short(diskContent);
  504 |   trace.record({ event: 'source.disk', sha256: diskHash, bytes: diskContent.length });
  505 | 
  506 |   // Assertions
  507 |   expect(nvimBuf, 'nvim buffer must contain Appended Heading').toContain(
  508 |     'Appended Heading',
```