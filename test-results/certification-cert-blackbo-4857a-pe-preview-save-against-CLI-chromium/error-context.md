# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_blackbox_001 full open-type-preview-save against CLI
- Location: tests/certification.spec.ts:544:1

# Error details

```
Error: initial preview must show heading

expect(locator).toContainText(expected) failed

Locator: locator('[data-testid="preview-frame"]').contentFrame().locator('body')
Expected substring: "Black-Box"
Received string:    ""
Timeout: 5000ms

Call log:
  - initial preview must show heading with timeout 5000ms
  - waiting for locator('[data-testid="preview-frame"]').contentFrame().locator('body')
    14 × locator resolved to <body></body>
       - unexpected value ""

```

# Test source

```ts
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
  499 |   // 3. Disk file
  500 |   const diskContent = readFile(file);
  501 |   const diskHash = sha256short(diskContent);
  502 |   trace.record({ event: 'source.disk', sha256: diskHash, bytes: diskContent.length });
  503 | 
  504 |   // Assertions
  505 |   expect(nvimBuf, 'nvim buffer must contain Appended Heading').toContain(
  506 |     'Appended Heading',
  507 |   );
  508 |   expect(nvimBuf, 'nvim buffer must contain added line').toContain('Added line');
  509 |   expect(nvimBuf, 'nvim buffer must contain Unicode').toContain('\u03b1');
  510 |   expect(nvimBuf, 'nvim buffer must contain citation').toContain('@doe99');
  511 | 
  512 |   // Server /buffer must match direct socket (exact equality)
  513 |   expect(bufData.buffer, 'server /buffer must equal nvim socket buffer').toBe(nvimBuf);
  514 |   expect(serverHash, 'hash must match').toBe(nvimHash);
  515 | 
  516 |   // Disk must match nvim buffer (normalize trailing newlines — files end with \n,
  517 |   // getline join with \n does not produce a final \n)
  518 |   const normDisk = diskContent.replace(/\n+$/, '');
  519 |   const normNvim = nvimBuf.replace(/\n+$/, '');
  520 |   expect(
  521 |     normDisk,
  522 |     'disk must equal nvim buffer after save (trailing newlines normalized)',
  523 |   ).toBe(normNvim);
  524 | 
  525 |   // Artifact
  526 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  527 | 
  528 |   trace.record({ event: 'cert.pass', test: 'cert_006' });
  529 | });
  530 | 
  531 | // ============================================================
  532 | // cert_blackbox_001: full open-type-preview-save against CLI
  533 | // ============================================================
  534 | 
  535 | let serverBbox: ServerInstance;
  536 | 
  537 | test.afterAll(async () => {
  538 |   if (serverBbox) {
  539 |     await killServer(serverBbox);
  540 |     // cleanup handled by server
  541 |   }
  542 | });
  543 | 
  544 | test('cert_blackbox_001 full open-type-preview-save against CLI', async ({ page }) => {
  545 |   const trace = new TraceContext('cert_blackbox_001');
  546 |   trace.record({ event: 'cert.start', test: 'cert_blackbox_001' });
  547 | 
  548 |   const SEED = '# Black-Box\n\nOpen, type, preview, save.\n';
  549 |   const file = seedTempFile('cbbox', SEED);
  550 |   trace.writeInitialFile(file, SEED);
  551 | 
  552 |   serverBbox = await launchServer(file);
  553 |   trace.record({ event: 'server.started', port: serverBbox.port, url: serverBbox.url });
  554 | 
  555 |   await page.goto(serverBbox.url);
  556 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  557 |   await page.waitForTimeout(1500);
  558 | 
  559 |   // Verify initial preview - render happens AFTER server start
  560 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  561 |   await expect(
  562 |     previewFrame.locator('body'),
  563 |     'initial preview must show heading',
> 564 |   ).toContainText('Black-Box', { timeout: 5000 });
      |     ^ Error: initial preview must show heading
  565 |   trace.recordRenderSuccess();
  566 | 
  567 |   // Type sentinel - keyboard happens AFTER initial render
  568 |   await page.locator('[data-testid="terminal"]').click();
  569 |   await page.keyboard.type('iBLACKBOX_SENTINEL_FINAL');
  570 |   await page.keyboard.press('Escape');
  571 |   await page.waitForTimeout(2000);
  572 |   trace.record({ event: 'browser.keyboard.sent' });
  573 | 
  574 |   // Assert preview updated - update happens AFTER keyboard
  575 |   await expect(
  576 |     previewFrame.locator('body'),
  577 |     'preview must update with BLACKBOX_SENTINEL_FINAL',
  578 |   ).toContainText('BLACKBOX_SENTINEL_FINAL', { timeout: 8000 });
  579 |   trace.recordPreviewUpdated();
  580 | 
  581 |   // Save - happens AFTER preview update
  582 |   trace.recordSaveStart();
  583 |   const saveRes = await page.evaluate(async () => {
  584 |     const r = await fetch('/api/save', { method: 'POST' });
  585 |     return r.json();
  586 |   });
  587 |   expect(saveRes.ok, 'save must return ok: true').toBe(true);
  588 |   await page.waitForTimeout(500);
  589 | 
  590 |   // Disk contains sentinel - verify AFTER save completes
  591 |   const diskContent = readFile(file);
  592 |   expect(diskContent, 'disk must contain BLACKBOX_SENTINEL_FINAL').toContain(
  593 |     'BLACKBOX_SENTINEL_FINAL',
  594 |   );
  595 |   trace.recordSaveSuccess(diskContent, sha256short(diskContent));
  596 | 
  597 |   // Artifact
  598 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  599 | 
  600 |   // Kill server cleanly
  601 |   await killServer(serverBbox);
  602 |   await new Promise((r) => setTimeout(r, 1000));
  603 | 
  604 |   // Assert no orphan nvim processes from this server
  605 |   const psAfter = spawnSync('ps', ['aux'], { encoding: 'utf-8', timeout: 3000 });
  606 |   const nvimLines = psAfter.stdout
  607 |     .split('\n')
  608 |     .filter(
  609 |       (l) =>
  610 |         l.includes('nvim') &&
  611 |         !l.includes('copilot') &&
  612 |         !l.includes('grep') &&
  613 |         !l.includes('NVIM'),
  614 |     );
  615 | 
  616 |   // Match only nvim processes related to this test's server (by PID or socket path)
  617 |   const serverNvimPid = serverBbox.nvimPid;
  618 |   const relevantOrphans = nvimLines.filter((l) => {
  619 |     const pidMatch = l.match(/^\s*\S+\s+(\d+)/);
  620 |     if (!pidMatch) return false;
  621 |     const pid = parseInt(pidMatch[1], 10);
  622 |     return pid === serverNvimPid;
  623 |   });
  624 | 
  625 |   trace.record({
  626 |     event: 'cleanup.orphans',
  627 |     nvimProcessCount: nvimLines.length,
  628 |     relevantOrphanCount: relevantOrphans.length,
  629 |     serverNvimPid,
  630 |   });
  631 |   trace.writeArtifact('ps-after-kill.txt', psAfter.stdout);
  632 |   expect(
  633 |     relevantOrphans.length,
  634 |     'no orphan nvim processes from this server after shutdown',
  635 |   ).toBe(0);
  636 | 
  637 |   trace.record({ event: 'cert.pass', test: 'cert_blackbox_001' });
  638 | });
  639 | 
```