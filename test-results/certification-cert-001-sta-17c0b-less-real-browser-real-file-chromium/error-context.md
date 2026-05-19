# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_001 startup — real nvim (not headless), real browser, real file
- Location: tests/certification.spec.ts:48:1

# Error details

```
Error: nvim argv must reference the file

expect(received).toContain(expected) // indexOf

Expected substring: "/tmp/pnp-c001-1MQ6nm/doc.md"
Received string:    "nvim --listen /tmp/pandoc-nvim-preview/nvim.sock /home/dzack/gitclones/pandoc-preview/tests/fixtures/test-doc.md
"
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import {
  3   |   seedTempFile,
  4   |   readFile,
  5   |   launchServer,
  6   |   killServer,
  7   |   nvimDirectRPC,
  8   |   nvimDirectSend,
  9   |   nvimDirectQuit,
  10  |   pandocRender,
  11  |   ServerInstance,
  12  | } from './helpers';
  13  | import {
  14  |   TraceContext,
  15  |   traceHas,
  16  |   traceOrder,
  17  |   traceNoEvent,
  18  |   sha256short,
  19  |   traceEventsOf,
  20  |   recordBufferRead,
  21  |   recordRenderSuccess,
  22  |   recordPreviewUpdated,
  23  |   recordSaveStart,
  24  |   recordSaveSuccess,
  25  |   assertTraceVersionOrder,
  26  |   assertSaveInvariant,
  27  | } from './trace';
  28  | import { execFileSync, spawn, spawnSync } from 'node:child_process';
  29  | import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
  30  | import { tmpdir } from 'node:os';
  31  | import { join } from 'node:path';
  32  | 
  33  | // Each test gets its own TraceContext, ServerInstance, temp file, port
  34  | 
  35  | // ============================================================
  36  | // cert_001: startup with real nvim, real browser, real file
  37  | // ============================================================
  38  | 
  39  | let server001: ServerInstance;
  40  | 
  41  | test.afterAll(async () => {
  42  |   if (server001) {
  43  |     await killServer(server001);
  44  |     // cleanup handled by server
  45  |   }
  46  | });
  47  | 
  48  | test('cert_001 startup — real nvim (not headless), real browser, real file', async ({
  49  |   page,
  50  | }) => {
  51  |   const trace = new TraceContext('cert_001');
  52  |   trace.record({ event: 'cert.start', test: 'cert_001' });
  53  | 
  54  |   const SEED = '# Startup Sentinel\n\nInitial body.\n';
  55  |   const file = seedTempFile('c001', SEED);
  56  |   trace.writeInitialFile(file, SEED);
  57  |   trace.record({ event: 'app.start', file, test: 'cert_001' });
  58  | 
  59  |   server001 = await launchServer(file);
  60  |   trace.record({ event: 'server.started', port: server001.port, url: server001.url });
  61  | 
  62  |   // Assert process tree contains real nvim
  63  |   const pTree = trace.captureProcessTree();
  64  |   expect(pTree, 'process tree must contain nvim').toContain('nvim');
  65  | 
  66  |   // Verify nvim is NOT headless
  67  |   const statusRes = await fetch(`${server001.url}/api/status`);
  68  |   const status = await statusRes.json();
  69  |   trace.record({
  70  |     event: 'pty.spawn.success',
  71  |     pid: status.pid,
  72  |     socket: status.socket,
  73  |     file: status.file,
  74  |   });
  75  |   expect(status.pid, 'nvim pid must be > 0').toBeGreaterThan(0);
  76  | 
  77  |   // Check nvim argv — must NOT contain --headless
  78  |   const psArgs = spawnSync('ps', ['-o', 'args=', '-p', String(status.pid)], {
  79  |     encoding: 'utf-8',
  80  |     timeout: 3000,
  81  |   });
  82  |   const nvimArgs = psArgs.stdout || '';
  83  |   trace.record({ event: 'nvim.argv', args: nvimArgs.trim() });
  84  |   expect(nvimArgs, 'nvim argv must NOT contain --headless').not.toContain('--headless');
  85  |   expect(nvimArgs, 'nvim argv must contain --listen').toContain('--listen');
> 86  |   expect(nvimArgs, 'nvim argv must reference the file').toContain(file);
      |                                                         ^ Error: nvim argv must reference the file
  87  | 
  88  |   // Socket must exist and answer
  89  |   expect(
  90  |     existsSync(server001.socketPath),
  91  |     `socket must exist at ${server001.socketPath}`,
  92  |   ).toBe(true);
  93  |   const rpcOut = nvimDirectRPC(server001.socketPath, '1');
  94  |   expect(rpcOut, 'nvim socket must answer remote-expr').toBe('1');
  95  |   trace.record({ event: 'nvim.ready.success', socket: server001.socketPath });
  96  | 
  97  |   // Open browser
  98  |   await page.goto(server001.url);
  99  |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  100 |   await page.waitForSelector('[data-testid="preview"]', { timeout: 5000 });
  101 |   trace.record({ event: 'browser.loaded', url: server001.url });
  102 | 
  103 |   const terminal = page.locator('[data-testid="terminal"]');
  104 |   await expect(terminal, 'terminal pane must be visible').toBeVisible();
  105 | 
  106 |   const preview = page.locator('[data-testid="preview"]');
  107 |   await expect(preview, 'preview pane must be visible').toBeVisible();
  108 | 
  109 |   // Screenshot artifact
  110 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  111 |   trace.record({ event: 'artifact.screenshot.png' });
  112 | 
  113 |   trace.record({ event: 'cert.pass', test: 'cert_001' });
  114 | });
  115 | 
  116 | // ============================================================
  117 | // cert_002: initial file renders in preview before any typing
  118 | // ============================================================
  119 | 
  120 | let server002: ServerInstance;
  121 | 
  122 | test.afterAll(async () => {
  123 |   if (server002) {
  124 |     await killServer(server002);
  125 |     // cleanup handled by server
  126 |   }
  127 | });
  128 | 
  129 | test('cert_002 initial file renders in preview before typing', async ({ page }) => {
  130 |   const trace = new TraceContext('cert_002');
  131 |   trace.record({ event: 'cert.start', test: 'cert_002' });
  132 | 
  133 |   const SEED = '# INITIAL_PREVIEW_SENTINEL\n\nLet $x^2$ be a term.\n';
  134 |   const file = seedTempFile('c002', SEED);
  135 |   trace.writeInitialFile(file, SEED);
  136 | 
  137 |   server002 = await launchServer(file);
  138 |   trace.record({ event: 'server.started', port: server002.port });
  139 | 
  140 |   // Wait for nvim readiness via socket
  141 |   let nvimReady = false;
  142 |   for (let i = 0; i < 20; i++) {
  143 |     try {
  144 |       const out = execFileSync(
  145 |         'nvim',
  146 |         ['--server', server002.socketPath, '--remote-expr', '1'],
  147 |         { encoding: 'utf-8', timeout: 3000 },
  148 |       );
  149 |       if (out.trim() === '1') {
  150 |         nvimReady = true;
  151 |         break;
  152 |       }
  153 |     } catch {}
  154 |     await new Promise((r) => setTimeout(r, 250));
  155 |   }
  156 |   expect(nvimReady, 'nvim must be ready via socket').toBe(true);
  157 |   trace.record({ event: 'nvim.ready.success', socket: server002.socketPath });
  158 | 
  159 |   // Give nvim a moment to actually load the file buffer
  160 |   await new Promise((r) => setTimeout(r, 300));
  161 | 
  162 |   // Read nvim buffer with version tracking
  163 |   const nvimBuf = nvimDirectRPC(server002.socketPath, 'join(getline(1, "$"), "\\n")');
  164 |   const bufHash = sha256short(nvimBuf);
  165 |   const { version } = trace.recordBufferRead(nvimBuf, bufHash);
  166 |   expect(nvimBuf, 'nvim buffer must contain sentinel').toContain(
  167 |     'INITIAL_PREVIEW_SENTINEL',
  168 |   );
  169 | 
  170 |   // Render independently with version link
  171 |   const pandocResult = pandocRender(nvimBuf);
  172 |   const htmlHash = sha256short(pandocResult.stdout);
  173 |   trace.recordRenderSuccess(htmlHash);
  174 |   expect(pandocResult.status, 'pandoc must exit 0').toBe(0);
  175 | 
  176 |   // Open browser
  177 |   await page.goto(server002.url);
  178 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  179 |   await page.waitForTimeout(2000);
  180 |   trace.record({ event: 'browser.loaded' });
  181 | 
  182 |   // Assert preview DOM contains sentinel
  183 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  184 |   const h1 = previewFrame.locator('h1').first();
  185 |   await expect(h1, 'preview must show INITIAL_PREVIEW_SENTINEL').toBeAttached({
  186 |     timeout: 8000,
```