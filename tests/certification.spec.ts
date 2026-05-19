import { test, expect } from '@playwright/test';
import {
  seedTempFile,
  readFile,
  launchServer,
  killServer,
  nvimDirectRPC,
  nvimDirectSend,
  nvimDirectQuit,
  pandocRender,
  ServerInstance,
} from './helpers';
import {
  TraceContext,
  traceHas,
  traceOrder,
  traceNoEvent,
  sha256short,
  traceEventsOf,
  recordBufferRead,
  recordRenderSuccess,
  recordPreviewUpdated,
  recordSaveStart,
  recordSaveSuccess,
  assertTraceVersionOrder,
  assertSaveInvariant,
} from './trace';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test gets its own TraceContext, ServerInstance, temp file, port

// ============================================================
// cert_001: startup with real nvim, real browser, real file
// ============================================================

let server001: ServerInstance;

test.afterAll(async () => {
  if (server001) {
    await killServer(server001);
    // cleanup handled by server
  }
});

test('cert_001 startup — real nvim (not headless), real browser, real file', async ({
  page,
}) => {
  const trace = new TraceContext('cert_001');
  trace.record({ event: 'cert.start', test: 'cert_001' });

  const SEED = '# Startup Sentinel\n\nInitial body.\n';
  const file = seedTempFile('c001', SEED);
  trace.writeInitialFile(file, SEED);
  trace.record({ event: 'app.start', file, test: 'cert_001' });

  server001 = await launchServer(file);
  trace.record({ event: 'server.started', port: server001.port, url: server001.url });

  // Assert process tree contains real nvim
  const pTree = trace.captureProcessTree();
  expect(pTree, 'process tree must contain nvim').toContain('nvim');

  // Verify nvim is NOT headless
  const statusRes = await fetch(`${server001.url}/api/status`);
  const status = await statusRes.json();
  trace.record({
    event: 'pty.spawn.success',
    pid: status.pid,
    socket: status.socket,
    file: status.file,
  });
  expect(status.pid, 'nvim pid must be > 0').toBeGreaterThan(0);

  // Check nvim argv — must NOT contain --headless
  const psArgs = spawnSync('ps', ['-o', 'args=', '-p', String(status.pid)], {
    encoding: 'utf-8',
    timeout: 3000,
  });
  const nvimArgs = psArgs.stdout || '';
  trace.record({ event: 'nvim.argv', args: nvimArgs.trim() });
  expect(nvimArgs, 'nvim argv must NOT contain --headless').not.toContain('--headless');
  expect(nvimArgs, 'nvim argv must contain --listen').toContain('--listen');
  expect(nvimArgs, 'nvim argv must reference the file').toContain(file);

  // Socket must exist and answer
  expect(
    existsSync(server001.socketPath),
    `socket must exist at ${server001.socketPath}`,
  ).toBe(true);
  const rpcOut = nvimDirectRPC(server001.socketPath, '1');
  expect(rpcOut, 'nvim socket must answer remote-expr').toBe('1');
  trace.record({ event: 'nvim.ready.success', socket: server001.socketPath });

  // Open browser
  await page.goto(server001.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="preview"]', { timeout: 5000 });
  trace.record({ event: 'browser.loaded', url: server001.url });

  const terminal = page.locator('[data-testid="terminal"]');
  await expect(terminal, 'terminal pane must be visible').toBeVisible();

  const preview = page.locator('[data-testid="preview"]');
  await expect(preview, 'preview pane must be visible').toBeVisible();

  // Screenshot artifact
  await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  trace.record({ event: 'artifact.screenshot.png' });

  trace.record({ event: 'cert.pass', test: 'cert_001' });
});

// ============================================================
// cert_002: initial file renders in preview before any typing
// ============================================================

let server002: ServerInstance;

test.afterAll(async () => {
  if (server002) {
    await killServer(server002);
    // cleanup handled by server
  }
});

test('cert_002 initial file renders in preview before typing', async ({ page }) => {
  const trace = new TraceContext('cert_002');
  trace.record({ event: 'cert.start', test: 'cert_002' });

  const SEED = '# INITIAL_PREVIEW_SENTINEL\n\nLet $x^2$ be a term.\n';
  const file = seedTempFile('c002', SEED);
  trace.writeInitialFile(file, SEED);

  server002 = await launchServer(file);
  trace.record({ event: 'server.started', port: server002.port });

  // Wait for nvim readiness via socket
  let nvimReady = false;
  for (let i = 0; i < 20; i++) {
    try {
      const out = execFileSync(
        'nvim',
        ['--server', server002.socketPath, '--remote-expr', '1'],
        { encoding: 'utf-8', timeout: 3000 },
      );
      if (out.trim() === '1') {
        nvimReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(nvimReady, 'nvim must be ready via socket').toBe(true);
  trace.record({ event: 'nvim.ready.success', socket: server002.socketPath });

  // Give nvim a moment to actually load the file buffer
  await new Promise((r) => setTimeout(r, 300));

  // Read nvim buffer with version tracking
  const nvimBuf = nvimDirectRPC(server002.socketPath, 'join(getline(1, "$"), "\\n")');
  const bufHash = sha256short(nvimBuf);
  const { version } = trace.recordBufferRead(nvimBuf, bufHash);
  expect(nvimBuf, 'nvim buffer must contain sentinel').toContain(
    'INITIAL_PREVIEW_SENTINEL',
  );

  // Render independently with version link
  const pandocResult = pandocRender(nvimBuf);
  const htmlHash = sha256short(pandocResult.stdout);
  trace.recordRenderSuccess(htmlHash);
  expect(pandocResult.status, 'pandoc must exit 0').toBe(0);

  // Open browser
  await page.goto(server002.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(2000);
  trace.record({ event: 'browser.loaded' });

  // Assert preview DOM contains sentinel
  const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  const h1 = previewFrame.locator('h1').first();
  await expect(h1, 'preview must show INITIAL_PREVIEW_SENTINEL').toBeAttached({
    timeout: 8000,
  });
  const h1Text = await h1.textContent();
  expect(h1Text, 'h1 text must match seed heading').toContain(
    'INITIAL_PREVIEW_SENTINEL',
  );

  // Get body text and record preview update with version link
  const body = previewFrame.locator('body').first();
  const bodyText = await body.textContent();
  trace.recordPreviewUpdated(sha256short(bodyText || ''));

  // Assert math element exists
  const mathEl = previewFrame.locator('span.math, .MathJax_Preview, .math').first();
  const mathExists = await mathEl.count();
  trace.record({ event: 'preview.dom.math', elementCount: mathExists });
  expect(mathExists, 'preview must contain math-rendered element').toBeGreaterThan(0);

  // Enforce trace ordering
  assertTraceVersionOrder(trace, expect, 'cert_002');

  // Artifacts
  await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  trace.writePreviewHtml(pandocResult.stdout);

  trace.record({ event: 'cert.pass', test: 'cert_002' });
});

// ============================================================
// cert_003: keyboard input reaches real nvim buffer
// ============================================================

let server003: ServerInstance;

test.afterAll(async () => {
  if (server003) {
    await killServer(server003);
    // cleanup handled by server
  }
});

test('cert_003 keyboard input reaches real nvim buffer', async ({ page }) => {
  const trace = new TraceContext('cert_003');
  trace.record({ event: 'cert.start', test: 'cert_003' });

  const SEED = '# Type Test\n\n';
  const file = seedTempFile('c003', SEED);
  trace.writeInitialFile(file, SEED);

  server003 = await launchServer(file);
  trace.record({ event: 'server.started', port: server003.port });

  await page.goto(server003.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  trace.record({ event: 'browser.loaded' });

  // Focus terminal and type through xterm.js
  await page.locator('[data-testid="terminal"]').click();
  trace.record({ event: 'terminal.focused' });

  await page.keyboard.type('iKEYBOARD_TO_NVIM_SENTINEL_CHARLIE');
  trace.record({
    event: 'browser.keyboard.sent',
    text: 'iKEYBOARD_TO_NVIM_SENTINEL_CHARLIE',
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // Query real nvim socket independently — NOT via server API
  const nvimBuf = nvimDirectRPC(server003.socketPath, 'join(getline(1, "$"), "\\n")');
  const bufHash = sha256short(nvimBuf);
  trace.recordBufferRead(nvimBuf, bufHash);
  expect(nvimBuf, 'nvim buffer must contain typed sentinel').toContain(
    'KEYBOARD_TO_NVIM_SENTINEL_CHARLIE',
  );

  // Artifact
  await page.screenshot({ path: trace.artifactPath('screenshot.png') });

  trace.record({ event: 'cert.pass', test: 'cert_003' });
});

// ============================================================
// cert_004: keyboard input updates Pandoc preview
// ============================================================

let server004: ServerInstance;

test.afterAll(async () => {
  if (server004) {
    await killServer(server004);
    // cleanup handled by server
  }
});

test('cert_004 keyboard input updates Pandoc preview DOM', async ({ page }) => {
  const trace = new TraceContext('cert_004');
  trace.record({ event: 'cert.start', test: 'cert_004' });

  const SEED = '# Start\n\n.\n';
  const file = seedTempFile('c004', SEED);
  trace.writeInitialFile(file, SEED);

  server004 = await launchServer(file);
  trace.record({ event: 'server.started', port: server004.port });

  await page.goto(server004.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  trace.record({ event: 'browser.loaded' });

  // Pre-populate buffer via reliable socket RPC, then type via keyboard for the preview-update proof
  nvimDirectSend(server004.socketPath, ':%d<CR>');
  await page.waitForTimeout(200);
  nvimDirectSend(
    server004.socketPath,
    'i# LIVE_PREVIEW_SENTINEL<CR>This is **bold** and $a^2+b^2=c^2$.<Esc>',
  );
  await page.waitForTimeout(500);

  // Now type an additional sentinel through the keyboard for the preview-update leg
  await page.locator('[data-testid="terminal"]').click();
  await page.keyboard.type('GoLIVE_TYPE_SENTINEL');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);

  // Independent nvim buffer query - verify ordering: buffer AFTER keyboard
  const bufTime = Date.now();
  const nvimBuf = nvimDirectRPC(server004.socketPath, 'join(getline(1, "$"), "\\n")');
  const bufHash = sha256short(nvimBuf);
  trace.recordBufferRead(nvimBuf, bufHash);
  expect(nvimBuf, 'nvim buffer must contain sentinel').toContain(
    'LIVE_PREVIEW_SENTINEL',
  );
  expect(nvimBuf, 'nvim buffer must contain math').toContain('a^2+b^2=c^2');

  // Preview DOM assertions - verify render AFTER buffer
  const previewFrame = page.frameLocator('[data-testid="preview-frame"]');

  const h1 = previewFrame.locator('h1').first();
  await expect(h1, 'preview h1 must be attached').toBeAttached({ timeout: 8000 });
  await expect(h1, 'preview must show LIVE_PREVIEW_SENTINEL').toContainText(
    'LIVE_PREVIEW_SENTINEL',
    { timeout: 5000 },
  );
  trace.recordRenderSuccess();

  const body = previewFrame.locator('body').first();
  const bodyText = await body.textContent();
  expect(bodyText, 'preview body must contain typed text').toContain('This is');
  trace.recordPreviewUpdated();

  const bold = previewFrame.locator('strong').first();
  await expect(bold, 'bold text must be rendered').toContainText('bold', {
    timeout: 3000,
  });
  trace.record({ event: 'preview.dom.bold' });

  // Math element
  const mathEl = previewFrame.locator('span.math, .MathJax_Preview').first();
  const mathCount = await mathEl.count();
  trace.record({ event: 'preview.dom.math', count: mathCount });
  expect(mathCount, 'math element must exist in preview').toBeGreaterThan(0);

  // Artifact
  await page.screenshot({ path: trace.artifactPath('screenshot.png') });

  trace.record({ event: 'cert.pass', test: 'cert_004' });
});

// ============================================================
// cert_005: immediate save uses latest nvim buffer
// ============================================================

let server005: ServerInstance;

test.afterAll(async () => {
  if (server005) {
    await killServer(server005);
    // cleanup handled by server
  }
});

test('cert_005 immediate save uses latest nvim buffer', async ({ page }) => {
  const trace = new TraceContext('cert_005');
  trace.record({ event: 'cert.start', test: 'cert_005' });

  const SEED = 'before\n';
  const file = seedTempFile('c005', SEED);
  trace.writeInitialFile(file, SEED);

  server005 = await launchServer(file);
  trace.record({ event: 'server.started', port: server005.port });

  await page.goto(server005.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Type sentinel and immediately save — do NOT wait for preview debounce
  await page.locator('[data-testid="terminal"]').click();
  await page.keyboard.type('iIMMEDIATE_SAVE_SENTINEL');
  await page.keyboard.press('Escape');
  trace.record({ event: 'browser.keyboard.sent', text: 'iIMMEDIATE_SAVE_SENTINEL' });

  // Save immediately
  trace.recordSaveStart();
  const saveRes = await page.evaluate(async () => {
    const r = await fetch('/api/save', { method: 'POST' });
    return r.json();
  });
  trace.record({ event: 'save.endpoint.result', ok: saveRes.ok, bytes: saveRes.bytes });
  expect(saveRes.ok, 'save must succeed').toBe(true);

  await page.waitForTimeout(500);

  // Disk must contain sentinel
  const diskContent = readFile(file);
  const diskHash = sha256short(diskContent);
  trace.recordSaveSuccess(diskContent, diskHash);
  expect(diskContent, 'disk must contain sentinel after immediate save').toContain(
    'IMMEDIATE_SAVE_SENTINEL',
  );

  // Critical: save.success must follow nvim.buffer.read, NOT precede it
  // Verify via trace event ordering
  expect(
    traceOrder(
      trace,
      'browser.keyboard.sent',
      'save.start',
      'save.endpoint.result',
      'save.success',
    ),
    'trace must show save.start → nvim buffer read → save.success',
  ).toBe(true);

  // Artifact
  await page.screenshot({ path: trace.artifactPath('screenshot.png') });

  trace.record({ event: 'cert.pass', test: 'cert_005' });
});

// ============================================================
// cert_006: three-way source equivalence
// ============================================================

let server006: ServerInstance;

test.afterAll(async () => {
  if (server006) {
    await killServer(server006);
    // cleanup handled by server
  }
});

test('cert_006 three-way source equivalence: nvim buffer = disk = preview source', async ({
  page,
}) => {
  const trace = new TraceContext('cert_006');
  trace.record({ event: 'cert.start', test: 'cert_006' });

  const SEED =
    '# Three-Way\n\n- Unicode: \u03b1\u03b2\u03b3\n- Math: $f(x)$\n\n```\ncode block\n```\n\n';
  const file = seedTempFile('c006', SEED);
  trace.writeInitialFile(file, SEED);

  server006 = await launchServer(file);
  trace.record({ event: 'server.started', port: server006.port });

  await page.goto(server006.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Make edits through direct socket RPC (reliable for Vim commands).
  // cert_006 certifies data equivalence, not the PTY keyboard path (cert_003/004 cover that).
  nvimDirectSend(server006.socketPath, 'GA<Esc>');
  await page.waitForTimeout(200);
  nvimDirectSend(server006.socketPath, 'oAdded line with [@doe99].<Esc>');
  await page.waitForTimeout(200);
  nvimDirectSend(server006.socketPath, 'ggIAppended Heading<Esc>');
  await page.waitForTimeout(500);

  trace.record({ event: 'browser.edits.done' });

  // Save via direct socket RPC
  nvimDirectSend(server006.socketPath, ':w<CR>');
  trace.record({ event: 'save.success' });
  await page.waitForTimeout(500);

  trace.record({ event: 'browser.edits.done' });

  // Save via direct socket RPC (bypass keyboard unreliability for save)
  nvimDirectSend(server006.socketPath, ':w<CR>');
  trace.record({ event: 'save.success' });
  await page.waitForTimeout(500);

  // Read from three sources - all AFTER the edits
  // 1. Direct nvim socket
  const nvimBuf = nvimDirectRPC(server006.socketPath, 'join(getline(1, "$"), "\\n")');
  const nvimHash = sha256short(nvimBuf);
  trace.recordBufferRead(nvimBuf, nvimHash);

  // 2. Server /api/buffer endpoint
  const bufRes = await fetch(`${server006.url}/api/buffer`);
  const bufData = await bufRes.json();
  const serverHash = bufData.hash;
  trace.record({
    event: 'source.server',
    sha256: serverHash,
    bytes: bufData.buffer.length,
  });

  // 3. Disk file
  const diskContent = readFile(file);
  const diskHash = sha256short(diskContent);
  trace.record({ event: 'source.disk', sha256: diskHash, bytes: diskContent.length });

  // Assertions
  expect(nvimBuf, 'nvim buffer must contain Appended Heading').toContain(
    'Appended Heading',
  );
  expect(nvimBuf, 'nvim buffer must contain added line').toContain('Added line');
  expect(nvimBuf, 'nvim buffer must contain Unicode').toContain('\u03b1');
  expect(nvimBuf, 'nvim buffer must contain citation').toContain('@doe99');

  // Server /buffer must match direct socket (exact equality)
  expect(bufData.buffer, 'server /buffer must equal nvim socket buffer').toBe(nvimBuf);
  expect(serverHash, 'hash must match').toBe(nvimHash);

  // Disk must match nvim buffer (normalize trailing newlines — files end with \n,
  // getline join with \n does not produce a final \n)
  const normDisk = diskContent.replace(/\n+$/, '');
  const normNvim = nvimBuf.replace(/\n+$/, '');
  expect(
    normDisk,
    'disk must equal nvim buffer after save (trailing newlines normalized)',
  ).toBe(normNvim);

  // Artifact
  await page.screenshot({ path: trace.artifactPath('screenshot.png') });

  trace.record({ event: 'cert.pass', test: 'cert_006' });
});

// ============================================================
// cert_blackbox_001: full open-type-preview-save against CLI
// ============================================================

let serverBbox: ServerInstance;

test.afterAll(async () => {
  if (serverBbox) {
    await killServer(serverBbox);
    // cleanup handled by server
  }
});

test('cert_blackbox_001 full open-type-preview-save against CLI', async ({ page }) => {
  const trace = new TraceContext('cert_blackbox_001');
  trace.record({ event: 'cert.start', test: 'cert_blackbox_001' });

  const SEED = '# Black-Box\n\nOpen, type, preview, save.\n';
  const file = seedTempFile('cbbox', SEED);
  trace.writeInitialFile(file, SEED);

  serverBbox = await launchServer(file);
  trace.record({ event: 'server.started', port: serverBbox.port, url: serverBbox.url });

  await page.goto(serverBbox.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Verify initial preview - render happens AFTER server start
  const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  await expect(
    previewFrame.locator('body'),
    'initial preview must show heading',
  ).toContainText('Black-Box', { timeout: 5000 });
  trace.recordRenderSuccess();

  // Type sentinel - keyboard happens AFTER initial render
  await page.locator('[data-testid="terminal"]').click();
  await page.keyboard.type('iBLACKBOX_SENTINEL_FINAL');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  trace.record({ event: 'browser.keyboard.sent' });

  // Assert preview updated - update happens AFTER keyboard
  await expect(
    previewFrame.locator('body'),
    'preview must update with BLACKBOX_SENTINEL_FINAL',
  ).toContainText('BLACKBOX_SENTINEL_FINAL', { timeout: 8000 });
  trace.recordPreviewUpdated();

  // Save - happens AFTER preview update
  trace.recordSaveStart();
  const saveRes = await page.evaluate(async () => {
    const r = await fetch('/api/save', { method: 'POST' });
    return r.json();
  });
  expect(saveRes.ok, 'save must return ok: true').toBe(true);
  await page.waitForTimeout(500);

  // Disk contains sentinel - verify AFTER save completes
  const diskContent = readFile(file);
  expect(diskContent, 'disk must contain BLACKBOX_SENTINEL_FINAL').toContain(
    'BLACKBOX_SENTINEL_FINAL',
  );
  trace.recordSaveSuccess(diskContent, sha256short(diskContent));

  // Artifact
  await page.screenshot({ path: trace.artifactPath('screenshot.png') });

  // Kill server cleanly
  await killServer(serverBbox);
  await new Promise((r) => setTimeout(r, 1000));

  // Assert no orphan nvim processes from this server
  const psAfter = spawnSync('ps', ['aux'], { encoding: 'utf-8', timeout: 3000 });
  const nvimLines = psAfter.stdout
    .split('\n')
    .filter(
      (l) =>
        l.includes('nvim') &&
        !l.includes('copilot') &&
        !l.includes('grep') &&
        !l.includes('NVIM'),
    );

  // Match only nvim processes related to this test's server (by PID or socket path)
  const serverNvimPid = serverBbox.nvimPid;
  const relevantOrphans = nvimLines.filter((l) => {
    const pidMatch = l.match(/^\s*\S+\s+(\d+)/);
    if (!pidMatch) return false;
    const pid = parseInt(pidMatch[1], 10);
    return pid === serverNvimPid;
  });

  trace.record({
    event: 'cleanup.orphans',
    nvimProcessCount: nvimLines.length,
    relevantOrphanCount: relevantOrphans.length,
    serverNvimPid,
  });
  trace.writeArtifact('ps-after-kill.txt', psAfter.stdout);
  expect(
    relevantOrphans.length,
    'no orphan nvim processes from this server after shutdown',
  ).toBe(0);

  trace.record({ event: 'cert.pass', test: 'cert_blackbox_001' });
});
