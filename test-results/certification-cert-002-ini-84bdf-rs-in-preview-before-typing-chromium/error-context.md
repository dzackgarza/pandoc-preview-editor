# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_002 initial file renders in preview before typing
- Location: tests/certification.spec.ts:131:1

# Error details

```
Error: preview must show INITIAL_PREVIEW_SENTINEL

expect(locator).toBeAttached() failed

Locator: locator('[data-testid="preview-frame"]').contentFrame().locator('h1').first()
Expected: attached
Timeout: 8000ms
Error: element(s) not found

Call log:
  - preview must show INITIAL_PREVIEW_SENTINEL with timeout 8000ms
  - waiting for locator('[data-testid="preview-frame"]').contentFrame().locator('h1').first()

```

# Test source

```ts
  87  |   expect(nvimArgs, 'nvim argv must contain --listen').toContain('--listen');
  88  |   expect(nvimArgs, 'nvim argv must reference the file').toContain(file);
  89  | 
  90  |   // Socket must exist and answer
  91  |   expect(
  92  |     existsSync(server001.socketPath),
  93  |     `socket must exist at ${server001.socketPath}`,
  94  |   ).toBe(true);
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
> 187 |   await expect(h1, 'preview must show INITIAL_PREVIEW_SENTINEL').toBeAttached({
      |                                                                  ^ Error: preview must show INITIAL_PREVIEW_SENTINEL
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
  261 |   expect(nvimBuf, 'nvim buffer must contain typed sentinel').toContain(
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
```