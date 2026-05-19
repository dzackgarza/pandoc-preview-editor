# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: proof-ladder.spec.ts >> L2.1 server_starts_nvim_and_status_reports_pid_socket
- Location: tests/proof-ladder.spec.ts:177:1

# Error details

```
Error: /api/status must report file path

expect(received).toBe(expected) // Object.is equality

Expected: "/tmp/pnp-l21-YIA2X1/doc.md"
Received: "/home/dzack/gitclones/pandoc-preview/tests/fixtures/test-doc.md"
```

# Test source

```ts
  89  |   const tmpDir = mkdtempSync(join(tmpdir(), 'pnp-l13-'));
  90  |   const filePath = join(tmpDir, 'doc.md');
  91  |   writeFileSync(filePath, '# Socket Test\n', 'utf-8');
  92  | 
  93  |   const nvimProc = spawn('nvim', ['--listen', SOCK, '--headless', filePath], {
  94  |     detached: true,
  95  |     stdio: 'ignore',
  96  |   });
  97  | 
  98  |   let ready = false;
  99  |   let lastErr = '';
  100 |   for (let i = 0; i < 20; i++) {
  101 |     try {
  102 |       const out = execFileSync('nvim', ['--server', SOCK, '--remote-expr', '1'], {
  103 |         encoding: 'utf-8',
  104 |         timeout: 3000,
  105 |       });
  106 |       if (out.trim() === '1') {
  107 |         ready = true;
  108 |         break;
  109 |       }
  110 |     } catch (e: any) {
  111 |       lastErr = e?.stderr || e?.message || String(e);
  112 |     }
  113 |     await new Promise((r) => setTimeout(r, 250));
  114 |   }
  115 | 
  116 |   expect(ready, `nvim socket ${SOCK} not ready after 5s; lastErr=${lastErr}`).toBe(
  117 |     true,
  118 |   );
  119 | 
  120 |   nvimDirectQuit(SOCK);
  121 |   await new Promise((r) => setTimeout(r, 500));
  122 |   nvimProc.kill();
  123 | });
  124 | 
  125 | test('L1.4 nvim_remote_expr_reads_initial_file — remote-expr returns seed buffer', async () => {
  126 |   const SEED = '# Initial Content\n\nHello world.\n';
  127 |   const SOCK = `/tmp/pnp-l14-${Date.now()}.sock`;
  128 |   const tmpDir = mkdtempSync(join(tmpdir(), 'pnp-l14-'));
  129 |   const filePath = join(tmpDir, 'doc.md');
  130 |   writeFileSync(filePath, SEED, 'utf-8');
  131 | 
  132 |   const nvimProc = spawn('nvim', ['--listen', SOCK, '--headless', filePath], {
  133 |     detached: true,
  134 |     stdio: 'ignore',
  135 |   });
  136 | 
  137 |   let ready = false;
  138 |   for (let i = 0; i < 20; i++) {
  139 |     try {
  140 |       const out = execFileSync('nvim', ['--server', SOCK, '--remote-expr', '1'], {
  141 |         encoding: 'utf-8',
  142 |         timeout: 3000,
  143 |       });
  144 |       if (out.trim() === '1') {
  145 |         ready = true;
  146 |         break;
  147 |       }
  148 |     } catch {
  149 |       /* not ready */
  150 |     }
  151 |     await new Promise((r) => setTimeout(r, 250));
  152 |   }
  153 |   expect(ready, `nvim socket not ready`).toBe(true);
  154 | 
  155 |   const buf = nvimDirectRPC(SOCK, 'join(getline(1, "$"), "\\n")');
  156 |   expect(buf, 'buffer must contain seed heading').toContain('Initial Content');
  157 |   expect(buf, 'buffer must contain seed body').toContain('Hello world');
  158 | 
  159 |   nvimDirectQuit(SOCK);
  160 |   await new Promise((r) => setTimeout(r, 500));
  161 |   nvimProc.kill();
  162 | });
  163 | 
  164 | // ============================================================
  165 | // LAYER 2: Server owns nvim correctly
  166 | // ============================================================
  167 | 
  168 | let serverL2: ServerInstance;
  169 | 
  170 | test.afterAll(async () => {
  171 |   if (serverL2) {
  172 |     await killServer(serverL2);
  173 |     // cleanup handled by server
  174 |   }
  175 | });
  176 | 
  177 | test('L2.1 server_starts_nvim_and_status_reports_pid_socket', async () => {
  178 |   const file = seedTempFile('l21', '# L2 Server\n\nStatus test.\n');
  179 |   serverL2 = await launchServer(file);
  180 | 
  181 |   const res = await fetch(`${serverL2.url}/api/status`);
  182 |   expect(res.status).toBe(200);
  183 |   const status = await res.json();
  184 | 
  185 |   expect(status.pid, '/api/status must report pid > 0').toBeGreaterThan(0);
  186 |   expect(status.socket, '/api/status must report correct socket').toBe(
  187 |     serverL2.socketPath,
  188 |   );
> 189 |   expect(status.file, '/api/status must report file path').toBe(file);
      |                                                            ^ Error: /api/status must report file path
  190 | 
  191 |   const ps = spawnSync('ps', ['-p', String(status.pid), '-o', 'pid,comm'], {
  192 |     encoding: 'utf-8',
  193 |     timeout: 3000,
  194 |   });
  195 |   expect(ps.stdout, 'ps must confirm nvim process').toContain('nvim');
  196 | });
  197 | 
  198 | test('L2.2 server_buffer_endpoint_reads_nvim_buffer', async () => {
  199 |   const file = seedTempFile('l22', '# L2 Buffer\n\nEndpoint test.\n');
  200 |   serverL2 = await launchServer(file);
  201 | 
  202 |   const res = await fetch(`${serverL2.url}/api/buffer`);
  203 |   expect(res.status).toBe(200);
  204 |   const data = await res.json();
  205 | 
  206 |   expect(data.buffer, '/api/buffer must contain seed heading').toContain('L2 Buffer');
  207 |   expect(data.buffer, '/api/buffer must contain seed body').toContain('Endpoint test');
  208 |   expect(data.hash, '/api/buffer must include non-empty hash').toBeTruthy();
  209 |   expect(typeof data.hash).toBe('string');
  210 |   expect(data.socketPath, '/api/buffer must report socket path').toBe(
  211 |     serverL2.socketPath,
  212 |   );
  213 | });
  214 | 
  215 | // ============================================================
  216 | // LAYER 3: Renderer facts — no nvim, no browser
  217 | // ============================================================
  218 | 
  219 | test('L3.1 pandoc_renders_markdown_heading_without_nvim', async () => {
  220 |   const md = '# The Title\n\nSome text. $E=mc^2$';
  221 |   const result = pandocRender(md);
  222 | 
  223 |   expect(result.status, `pandoc exit code must be 0; stderr=${result.stderr}`).toBe(0);
  224 |   expect(result.stdout, 'pandoc output must contain heading text').toContain(
  225 |     'The Title',
  226 |   );
  227 |   expect(result.stdout, 'pandoc must render math as span.math.inline').toMatch(
  228 |     /<span class="math inline">/,
  229 |   );
  230 | });
  231 | 
  232 | test('L3.2 pandoc renders citation as span with data-cites', async () => {
  233 |   const md = 'See @doe99.';
  234 |   const result = pandocRender(md);
  235 | 
  236 |   // --citeproc with no bibliography: pandoc exits 0 but emits a warning comment
  237 |   expect(result.stdout, 'pandoc must include citation author').toContain('doe99');
  238 |   expect(result.stdout, 'pandoc must render citation span').toMatch(
  239 |     /<span class="citation"[^>]*data-cites="doe99"/,
  240 |   );
  241 | });
  242 | 
  243 | // ============================================================
  244 | // LAYER 4: WebSocket / preview delivery
  245 | // ============================================================
  246 | 
  247 | let serverL4: ServerInstance;
  248 | 
  249 | test.afterAll(async () => {
  250 |   if (serverL4) {
  251 |     await killServer(serverL4);
  252 |     // cleanup handled by server
  253 |   }
  254 | });
  255 | 
  256 | test('L4.1 websocket_preview_delivery — iframe receives server-rendered HTML', async ({
  257 |   page,
  258 | }) => {
  259 |   const file = seedTempFile('l41', '# WS Delivery\n\n**bold** text.\n');
  260 |   serverL4 = await launchServer(file);
  261 | 
  262 |   await page.goto(serverL4.url);
  263 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  264 |   await page.waitForTimeout(2000);
  265 | 
  266 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  267 |   const h1 = previewFrame.locator('h1').first();
  268 |   await expect(h1, 'iframe must contain heading after WS delivery').toBeAttached({
  269 |     timeout: 8000,
  270 |   });
  271 | 
  272 |   const text = await h1.textContent();
  273 |   expect(text, 'h1 text must match seed file heading').toContain('WS Delivery');
  274 | 
  275 |   const bold = previewFrame.locator('strong').first();
  276 |   await expect(bold, 'bold text must appear via WS delivery').toContainText('bold', {
  277 |     timeout: 3000,
  278 |   });
  279 | });
  280 | 
  281 | // ============================================================
  282 | // LAYER 5: Terminal input reaches nvim
  283 | // ============================================================
  284 | 
  285 | let serverL5: ServerInstance;
  286 | 
  287 | test.afterAll(async () => {
  288 |   if (serverL5) {
  289 |     await killServer(serverL5);
```