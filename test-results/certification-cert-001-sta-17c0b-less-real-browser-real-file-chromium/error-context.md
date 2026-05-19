# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_001 startup — real nvim (not headless), real browser, real file
- Location: tests/certification.spec.ts:50:1

# Error details

```
Error: socket must exist at /tmp/pandoc-nvim-preview/nvim.sock

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
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
  11  |   getFreePort,
  12  |   cleanServerArtifacts,
  13  |   ServerInstance,
  14  | } from './helpers';
  15  | import {
  16  |   TraceContext,
  17  |   traceHas,
  18  |   traceOrder,
  19  |   traceNoEvent,
  20  |   sha256short,
  21  |   traceEventsOf,
  22  |   recordBufferRead,
  23  |   recordRenderSuccess,
  24  |   recordPreviewUpdated,
  25  |   recordSaveStart,
  26  |   recordSaveSuccess,
  27  |   assertTraceVersionOrder,
  28  |   assertSaveInvariant,
  29  | } from './trace';
  30  | import { execFileSync, spawn, spawnSync } from 'node:child_process';
  31  | import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
  32  | import { tmpdir } from 'node:os';
  33  | import { join } from 'node:path';
  34  | 
  35  | // Each test gets its own TraceContext, ServerInstance, temp file, port
  36  | 
  37  | // ============================================================
  38  | // cert_001: startup with real nvim, real browser, real file
  39  | // ============================================================
  40  | 
  41  | let server001: ServerInstance;
  42  | 
  43  | test.afterAll(async () => {
  44  |   if (server001) {
  45  |     await killServer(server001);
  46  |     cleanServerArtifacts(server001);
  47  |   }
  48  | });
  49  | 
  50  | test('cert_001 startup — real nvim (not headless), real browser, real file', async ({
  51  |   page,
  52  | }) => {
  53  |   const trace = new TraceContext('cert_001');
  54  |   trace.record({ event: 'cert.start', test: 'cert_001' });
  55  | 
  56  |   const SEED = '# Startup Sentinel\n\nInitial body.\n';
  57  |   const file = seedTempFile('c001', SEED);
  58  |   trace.writeInitialFile(file, SEED);
  59  |   trace.record({ event: 'app.start', file, test: 'cert_001' });
  60  | 
  61  |   server001 = await launchServer(file);
  62  |   trace.record({ event: 'server.started', port: server001.port, url: server001.url });
  63  | 
  64  |   // Assert process tree contains real nvim
  65  |   const pTree = trace.captureProcessTree();
  66  |   expect(pTree, 'process tree must contain nvim').toContain('nvim');
  67  | 
  68  |   // Verify nvim is NOT headless
  69  |   const statusRes = await fetch(`${server001.url}/api/status`);
  70  |   const status = await statusRes.json();
  71  |   trace.record({
  72  |     event: 'pty.spawn.success',
  73  |     pid: status.pid,
  74  |     socket: status.socket,
  75  |     file: status.file,
  76  |   });
  77  |   expect(status.pid, 'nvim pid must be > 0').toBeGreaterThan(0);
  78  | 
  79  |   // Check nvim argv — must NOT contain --headless
  80  |   const psArgs = spawnSync('ps', ['-o', 'args=', '-p', String(status.pid)], {
  81  |     encoding: 'utf-8',
  82  |     timeout: 3000,
  83  |   });
  84  |   const nvimArgs = psArgs.stdout || '';
  85  |   trace.record({ event: 'nvim.argv', args: nvimArgs.trim() });
  86  |   expect(nvimArgs, 'nvim argv must NOT contain --headless').not.toContain('--headless');
  87  |   expect(nvimArgs, 'nvim argv must contain --listen').toContain('--listen');
  88  |   expect(nvimArgs, 'nvim argv must reference the file').toContain(file);
  89  | 
  90  |   // Socket must exist and answer
  91  |   expect(
  92  |     existsSync(server001.socketPath),
  93  |     `socket must exist at ${server001.socketPath}`,
> 94  |   ).toBe(true);
      |     ^ Error: socket must exist at /tmp/pandoc-nvim-preview/nvim.sock
  95  |   const rpcOut = nvimDirectRPC(server001.socketPath, '1');
  96  |   expect(rpcOut, 'nvim socket must answer remote-expr').toBe('1');
  97  |   trace.record({ event: 'nvim.ready.success', socket: server001.socketPath });
  98  | 
  99  |   // Open browser
  100 |   await page.goto(server001.url);
  101 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  102 |   await page.waitForSelector('[data-testid="preview"]', { timeout: 5000 });
  103 |   trace.record({ event: 'browser.loaded', url: server001.url });
  104 | 
  105 |   const terminal = page.locator('[data-testid="terminal"]');
  106 |   await expect(terminal, 'terminal pane must be visible').toBeVisible();
  107 | 
  108 |   const preview = page.locator('[data-testid="preview"]');
  109 |   await expect(preview, 'preview pane must be visible').toBeVisible();
  110 | 
  111 |   // Screenshot artifact
  112 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  113 |   trace.record({ event: 'artifact.screenshot.png' });
  114 | 
  115 |   trace.record({ event: 'cert.pass', test: 'cert_001' });
  116 | });
  117 | 
  118 | // ============================================================
  119 | // cert_002: initial file renders in preview before any typing
  120 | // ============================================================
  121 | 
  122 | let server002: ServerInstance;
  123 | 
  124 | test.afterAll(async () => {
  125 |   if (server002) {
  126 |     await killServer(server002);
  127 |     cleanServerArtifacts(server002);
  128 |   }
  129 | });
  130 | 
  131 | test('cert_002 initial file renders in preview before typing', async ({ page }) => {
  132 |   const trace = new TraceContext('cert_002');
  133 |   trace.record({ event: 'cert.start', test: 'cert_002' });
  134 | 
  135 |   const SEED = '# INITIAL_PREVIEW_SENTINEL\n\nLet $x^2$ be a term.\n';
  136 |   const file = seedTempFile('c002', SEED);
  137 |   trace.writeInitialFile(file, SEED);
  138 | 
  139 |   server002 = await launchServer(file);
  140 |   trace.record({ event: 'server.started', port: server002.port });
  141 | 
  142 |   // Wait for nvim readiness via socket
  143 |   let nvimReady = false;
  144 |   for (let i = 0; i < 20; i++) {
  145 |     try {
  146 |       const out = execFileSync(
  147 |         'nvim',
  148 |         ['--server', server002.socketPath, '--remote-expr', '1'],
  149 |         { encoding: 'utf-8', timeout: 3000 },
  150 |       );
  151 |       if (out.trim() === '1') {
  152 |         nvimReady = true;
  153 |         break;
  154 |       }
  155 |     } catch {}
  156 |     await new Promise((r) => setTimeout(r, 250));
  157 |   }
  158 |   expect(nvimReady, 'nvim must be ready via socket').toBe(true);
  159 |   trace.record({ event: 'nvim.ready.success', socket: server002.socketPath });
  160 | 
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
```