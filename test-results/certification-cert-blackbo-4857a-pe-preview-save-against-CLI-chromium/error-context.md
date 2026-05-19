# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_blackbox_001 full open-type-preview-save against CLI
- Location: tests/certification.spec.ts:546:1

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
    13 × locator resolved to <body></body>
       - unexpected value ""

```

# Test source

```ts
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
  509 |   );
  510 |   expect(nvimBuf, 'nvim buffer must contain added line').toContain('Added line');
  511 |   expect(nvimBuf, 'nvim buffer must contain Unicode').toContain('\u03b1');
  512 |   expect(nvimBuf, 'nvim buffer must contain citation').toContain('@doe99');
  513 | 
  514 |   // Server /buffer must match direct socket (exact equality)
  515 |   expect(bufData.buffer, 'server /buffer must equal nvim socket buffer').toBe(nvimBuf);
  516 |   expect(serverHash, 'hash must match').toBe(nvimHash);
  517 | 
  518 |   // Disk must match nvim buffer (normalize trailing newlines — files end with \n,
  519 |   // getline join with \n does not produce a final \n)
  520 |   const normDisk = diskContent.replace(/\n+$/, '');
  521 |   const normNvim = nvimBuf.replace(/\n+$/, '');
  522 |   expect(
  523 |     normDisk,
  524 |     'disk must equal nvim buffer after save (trailing newlines normalized)',
  525 |   ).toBe(normNvim);
  526 | 
  527 |   // Artifact
  528 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  529 | 
  530 |   trace.record({ event: 'cert.pass', test: 'cert_006' });
  531 | });
  532 | 
  533 | // ============================================================
  534 | // cert_blackbox_001: full open-type-preview-save against CLI
  535 | // ============================================================
  536 | 
  537 | let serverBbox: ServerInstance;
  538 | 
  539 | test.afterAll(async () => {
  540 |   if (serverBbox) {
  541 |     await killServer(serverBbox);
  542 |     cleanServerArtifacts(serverBbox);
  543 |   }
  544 | });
  545 | 
  546 | test('cert_blackbox_001 full open-type-preview-save against CLI', async ({ page }) => {
  547 |   const trace = new TraceContext('cert_blackbox_001');
  548 |   trace.record({ event: 'cert.start', test: 'cert_blackbox_001' });
  549 | 
  550 |   const SEED = '# Black-Box\n\nOpen, type, preview, save.\n';
  551 |   const file = seedTempFile('cbbox', SEED);
  552 |   trace.writeInitialFile(file, SEED);
  553 | 
  554 |   serverBbox = await launchServer(file);
  555 |   trace.record({ event: 'server.started', port: serverBbox.port, url: serverBbox.url });
  556 | 
  557 |   await page.goto(serverBbox.url);
  558 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  559 |   await page.waitForTimeout(1500);
  560 | 
  561 |   // Verify initial preview - render happens AFTER server start
  562 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  563 |   await expect(
  564 |     previewFrame.locator('body'),
  565 |     'initial preview must show heading',
> 566 |   ).toContainText('Black-Box', { timeout: 5000 });
      |     ^ Error: initial preview must show heading
  567 |   trace.recordRenderSuccess();
  568 | 
  569 |   // Type sentinel - keyboard happens AFTER initial render
  570 |   await page.locator('[data-testid="terminal"]').click();
  571 |   await page.keyboard.type('iBLACKBOX_SENTINEL_FINAL');
  572 |   await page.keyboard.press('Escape');
  573 |   await page.waitForTimeout(2000);
  574 |   trace.record({ event: 'browser.keyboard.sent' });
  575 | 
  576 |   // Assert preview updated - update happens AFTER keyboard
  577 |   await expect(
  578 |     previewFrame.locator('body'),
  579 |     'preview must update with BLACKBOX_SENTINEL_FINAL',
  580 |   ).toContainText('BLACKBOX_SENTINEL_FINAL', { timeout: 8000 });
  581 |   trace.recordPreviewUpdated();
  582 | 
  583 |   // Save - happens AFTER preview update
  584 |   trace.recordSaveStart();
  585 |   const saveRes = await page.evaluate(async () => {
  586 |     const r = await fetch('/api/save', { method: 'POST' });
  587 |     return r.json();
  588 |   });
  589 |   expect(saveRes.ok, 'save must return ok: true').toBe(true);
  590 |   await page.waitForTimeout(500);
  591 | 
  592 |   // Disk contains sentinel - verify AFTER save completes
  593 |   const diskContent = readFile(file);
  594 |   expect(diskContent, 'disk must contain BLACKBOX_SENTINEL_FINAL').toContain(
  595 |     'BLACKBOX_SENTINEL_FINAL',
  596 |   );
  597 |   trace.recordSaveSuccess(diskContent, sha256short(diskContent));
  598 | 
  599 |   // Artifact
  600 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  601 | 
  602 |   // Kill server cleanly
  603 |   await killServer(serverBbox);
  604 |   await new Promise((r) => setTimeout(r, 1000));
  605 | 
  606 |   // Assert no orphan nvim processes from this server
  607 |   const psAfter = spawnSync('ps', ['aux'], { encoding: 'utf-8', timeout: 3000 });
  608 |   const nvimLines = psAfter.stdout
  609 |     .split('\n')
  610 |     .filter(
  611 |       (l) =>
  612 |         l.includes('nvim') &&
  613 |         !l.includes('copilot') &&
  614 |         !l.includes('grep') &&
  615 |         !l.includes('NVIM'),
  616 |     );
  617 | 
  618 |   // Match only nvim processes related to this test's server (by PID or socket path)
  619 |   const serverNvimPid = serverBbox.nvimPid;
  620 |   const relevantOrphans = nvimLines.filter((l) => {
  621 |     const pidMatch = l.match(/^\s*\S+\s+(\d+)/);
  622 |     if (!pidMatch) return false;
  623 |     const pid = parseInt(pidMatch[1], 10);
  624 |     return pid === serverNvimPid;
  625 |   });
  626 | 
  627 |   trace.record({
  628 |     event: 'cleanup.orphans',
  629 |     nvimProcessCount: nvimLines.length,
  630 |     relevantOrphanCount: relevantOrphans.length,
  631 |     serverNvimPid,
  632 |   });
  633 |   trace.writeArtifact('ps-after-kill.txt', psAfter.stdout);
  634 |   expect(
  635 |     relevantOrphans.length,
  636 |     'no orphan nvim processes from this server after shutdown',
  637 |   ).toBe(0);
  638 | 
  639 |   trace.record({ event: 'cert.pass', test: 'cert_blackbox_001' });
  640 | });
  641 | 
```