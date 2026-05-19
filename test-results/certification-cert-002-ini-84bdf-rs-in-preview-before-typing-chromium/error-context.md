# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_002 initial file renders in preview before typing
- Location: tests/certification.spec.ts:129:1

# Error details

```
Error: nvim must be ready via socket

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
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
  86  |   expect(nvimArgs, 'nvim argv must reference the file').toContain(file);
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
> 156 |   expect(nvimReady, 'nvim must be ready via socket').toBe(true);
      |                                                      ^ Error: nvim must be ready via socket
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
  187 |   });
  188 |   const h1Text = await h1.textContent();
  189 |   expect(h1Text, 'h1 text must match seed heading').toContain(
  190 |     'INITIAL_PREVIEW_SENTINEL',
  191 |   );
  192 | 
  193 |   // Get body text and record preview update with version link
  194 |   const body = previewFrame.locator('body').first();
  195 |   const bodyText = await body.textContent();
  196 |   trace.recordPreviewUpdated(sha256short(bodyText || ''));
  197 | 
  198 |   // Assert math element exists
  199 |   const mathEl = previewFrame.locator('span.math, .MathJax_Preview, .math').first();
  200 |   const mathExists = await mathEl.count();
  201 |   trace.record({ event: 'preview.dom.math', elementCount: mathExists });
  202 |   expect(mathExists, 'preview must contain math-rendered element').toBeGreaterThan(0);
  203 | 
  204 |   // Enforce trace ordering
  205 |   assertTraceVersionOrder(trace, expect, 'cert_002');
  206 | 
  207 |   // Artifacts
  208 |   await page.screenshot({ path: trace.artifactPath('screenshot.png') });
  209 |   trace.writePreviewHtml(pandocResult.stdout);
  210 | 
  211 |   trace.record({ event: 'cert.pass', test: 'cert_002' });
  212 | });
  213 | 
  214 | // ============================================================
  215 | // cert_003: keyboard input reaches real nvim buffer
  216 | // ============================================================
  217 | 
  218 | let server003: ServerInstance;
  219 | 
  220 | test.afterAll(async () => {
  221 |   if (server003) {
  222 |     await killServer(server003);
  223 |     // cleanup handled by server
  224 |   }
  225 | });
  226 | 
  227 | test('cert_003 keyboard input reaches real nvim buffer', async ({ page }) => {
  228 |   const trace = new TraceContext('cert_003');
  229 |   trace.record({ event: 'cert.start', test: 'cert_003' });
  230 | 
  231 |   const SEED = '# Type Test\n\n';
  232 |   const file = seedTempFile('c003', SEED);
  233 |   trace.writeInitialFile(file, SEED);
  234 | 
  235 |   server003 = await launchServer(file);
  236 |   trace.record({ event: 'server.started', port: server003.port });
  237 | 
  238 |   await page.goto(server003.url);
  239 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  240 |   await page.waitForTimeout(1500);
  241 |   trace.record({ event: 'browser.loaded' });
  242 | 
  243 |   // Focus terminal and type through xterm.js
  244 |   await page.locator('[data-testid="terminal"]').click();
  245 |   trace.record({ event: 'terminal.focused' });
  246 | 
  247 |   await page.keyboard.type('iKEYBOARD_TO_NVIM_SENTINEL_CHARLIE');
  248 |   trace.record({
  249 |     event: 'browser.keyboard.sent',
  250 |     text: 'iKEYBOARD_TO_NVIM_SENTINEL_CHARLIE',
  251 |   });
  252 |   await page.keyboard.press('Escape');
  253 |   await page.waitForTimeout(1000);
  254 | 
  255 |   // Query real nvim socket independently — NOT via server API
  256 |   const nvimBuf = nvimDirectRPC(server003.socketPath, 'join(getline(1, "$"), "\\n")');
```