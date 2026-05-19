# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: proof-ladder.spec.ts >> L2.2 server_buffer_endpoint_reads_nvim_buffer
- Location: tests/proof-ladder.spec.ts:200:1

# Error details

```
Error: /api/buffer must contain seed heading

expect(received).toContain(expected) // indexOf

Expected substring: "L2 Buffer"
Received string:    ""
```

# Test source

```ts
  108 |       if (out.trim() === '1') {
  109 |         ready = true;
  110 |         break;
  111 |       }
  112 |     } catch (e: any) {
  113 |       lastErr = e?.stderr || e?.message || String(e);
  114 |     }
  115 |     await new Promise((r) => setTimeout(r, 250));
  116 |   }
  117 | 
  118 |   expect(ready, `nvim socket ${SOCK} not ready after 5s; lastErr=${lastErr}`).toBe(
  119 |     true,
  120 |   );
  121 | 
  122 |   nvimDirectQuit(SOCK);
  123 |   await new Promise((r) => setTimeout(r, 500));
  124 |   nvimProc.kill();
  125 | });
  126 | 
  127 | test('L1.4 nvim_remote_expr_reads_initial_file — remote-expr returns seed buffer', async () => {
  128 |   const SEED = '# Initial Content\n\nHello world.\n';
  129 |   const SOCK = `/tmp/pnp-l14-${Date.now()}.sock`;
  130 |   const tmpDir = mkdtempSync(join(tmpdir(), 'pnp-l14-'));
  131 |   const filePath = join(tmpDir, 'doc.md');
  132 |   writeFileSync(filePath, SEED, 'utf-8');
  133 | 
  134 |   const nvimProc = spawn('nvim', ['--listen', SOCK, '--headless', filePath], {
  135 |     detached: true,
  136 |     stdio: 'ignore',
  137 |   });
  138 | 
  139 |   let ready = false;
  140 |   for (let i = 0; i < 20; i++) {
  141 |     try {
  142 |       const out = execFileSync('nvim', ['--server', SOCK, '--remote-expr', '1'], {
  143 |         encoding: 'utf-8',
  144 |         timeout: 3000,
  145 |       });
  146 |       if (out.trim() === '1') {
  147 |         ready = true;
  148 |         break;
  149 |       }
  150 |     } catch {
  151 |       /* not ready */
  152 |     }
  153 |     await new Promise((r) => setTimeout(r, 250));
  154 |   }
  155 |   expect(ready, `nvim socket not ready`).toBe(true);
  156 | 
  157 |   const buf = nvimDirectRPC(SOCK, 'join(getline(1, "$"), "\\n")');
  158 |   expect(buf, 'buffer must contain seed heading').toContain('Initial Content');
  159 |   expect(buf, 'buffer must contain seed body').toContain('Hello world');
  160 | 
  161 |   nvimDirectQuit(SOCK);
  162 |   await new Promise((r) => setTimeout(r, 500));
  163 |   nvimProc.kill();
  164 | });
  165 | 
  166 | // ============================================================
  167 | // LAYER 2: Server owns nvim correctly
  168 | // ============================================================
  169 | 
  170 | let serverL2: ServerInstance;
  171 | 
  172 | test.afterAll(async () => {
  173 |   if (serverL2) {
  174 |     await killServer(serverL2);
  175 |     cleanServerArtifacts(serverL2);
  176 |   }
  177 | });
  178 | 
  179 | test('L2.1 server_starts_nvim_and_status_reports_pid_socket', async () => {
  180 |   const file = seedTempFile('l21', '# L2 Server\n\nStatus test.\n');
  181 |   serverL2 = await launchServer(file);
  182 | 
  183 |   const res = await fetch(`${serverL2.url}/api/status`);
  184 |   expect(res.status).toBe(200);
  185 |   const status = await res.json();
  186 | 
  187 |   expect(status.pid, '/api/status must report pid > 0').toBeGreaterThan(0);
  188 |   expect(status.socket, '/api/status must report correct socket').toBe(
  189 |     serverL2.socketPath,
  190 |   );
  191 |   expect(status.file, '/api/status must report file path').toBe(file);
  192 | 
  193 |   const ps = spawnSync('ps', ['-p', String(status.pid), '-o', 'pid,comm'], {
  194 |     encoding: 'utf-8',
  195 |     timeout: 3000,
  196 |   });
  197 |   expect(ps.stdout, 'ps must confirm nvim process').toContain('nvim');
  198 | });
  199 | 
  200 | test('L2.2 server_buffer_endpoint_reads_nvim_buffer', async () => {
  201 |   const file = seedTempFile('l22', '# L2 Buffer\n\nEndpoint test.\n');
  202 |   serverL2 = await launchServer(file);
  203 | 
  204 |   const res = await fetch(`${serverL2.url}/api/buffer`);
  205 |   expect(res.status).toBe(200);
  206 |   const data = await res.json();
  207 | 
> 208 |   expect(data.buffer, '/api/buffer must contain seed heading').toContain('L2 Buffer');
      |                                                                ^ Error: /api/buffer must contain seed heading
  209 |   expect(data.buffer, '/api/buffer must contain seed body').toContain('Endpoint test');
  210 |   expect(data.hash, '/api/buffer must include non-empty hash').toBeTruthy();
  211 |   expect(typeof data.hash).toBe('string');
  212 |   expect(data.socketPath, '/api/buffer must report socket path').toBe(
  213 |     serverL2.socketPath,
  214 |   );
  215 | });
  216 | 
  217 | // ============================================================
  218 | // LAYER 3: Renderer facts — no nvim, no browser
  219 | // ============================================================
  220 | 
  221 | test('L3.1 pandoc_renders_markdown_heading_without_nvim', async () => {
  222 |   const md = '# The Title\n\nSome text. $E=mc^2$';
  223 |   const result = pandocRender(md);
  224 | 
  225 |   expect(result.status, `pandoc exit code must be 0; stderr=${result.stderr}`).toBe(0);
  226 |   expect(result.stdout, 'pandoc output must contain heading text').toContain(
  227 |     'The Title',
  228 |   );
  229 |   expect(result.stdout, 'pandoc must render math as span.math.inline').toMatch(
  230 |     /<span class="math inline">/,
  231 |   );
  232 | });
  233 | 
  234 | test('L3.2 pandoc renders citation as span with data-cites', async () => {
  235 |   const md = 'See @doe99.';
  236 |   const result = pandocRender(md);
  237 | 
  238 |   // --citeproc with no bibliography: pandoc exits 0 but emits a warning comment
  239 |   expect(result.stdout, 'pandoc must include citation author').toContain('doe99');
  240 |   expect(result.stdout, 'pandoc must render citation span').toMatch(
  241 |     /<span class="citation"[^>]*data-cites="doe99"/,
  242 |   );
  243 | });
  244 | 
  245 | // ============================================================
  246 | // LAYER 4: WebSocket / preview delivery
  247 | // ============================================================
  248 | 
  249 | let serverL4: ServerInstance;
  250 | 
  251 | test.afterAll(async () => {
  252 |   if (serverL4) {
  253 |     await killServer(serverL4);
  254 |     cleanServerArtifacts(serverL4);
  255 |   }
  256 | });
  257 | 
  258 | test('L4.1 websocket_preview_delivery — iframe receives server-rendered HTML', async ({
  259 |   page,
  260 | }) => {
  261 |   const file = seedTempFile('l41', '# WS Delivery\n\n**bold** text.\n');
  262 |   serverL4 = await launchServer(file);
  263 | 
  264 |   await page.goto(serverL4.url);
  265 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  266 |   await page.waitForTimeout(2000);
  267 | 
  268 |   const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  269 |   const h1 = previewFrame.locator('h1').first();
  270 |   await expect(h1, 'iframe must contain heading after WS delivery').toBeAttached({
  271 |     timeout: 8000,
  272 |   });
  273 | 
  274 |   const text = await h1.textContent();
  275 |   expect(text, 'h1 text must match seed file heading').toContain('WS Delivery');
  276 | 
  277 |   const bold = previewFrame.locator('strong').first();
  278 |   await expect(bold, 'bold text must appear via WS delivery').toContainText('bold', {
  279 |     timeout: 3000,
  280 |   });
  281 | });
  282 | 
  283 | // ============================================================
  284 | // LAYER 5: Terminal input reaches nvim
  285 | // ============================================================
  286 | 
  287 | let serverL5: ServerInstance;
  288 | 
  289 | test.afterAll(async () => {
  290 |   if (serverL5) {
  291 |     await killServer(serverL5);
  292 |     cleanServerArtifacts(serverL5);
  293 |   }
  294 | });
  295 | 
  296 | test('L5.1 xterm_keyboard_input_changes_nvim_buffer', async ({ page }) => {
  297 |   const file = seedTempFile('l51', '# L5 Type\n\n');
  298 |   serverL5 = await launchServer(file);
  299 | 
  300 |   await page.goto(serverL5.url);
  301 |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  302 |   await page.waitForTimeout(1500);
  303 | 
  304 |   // Type into xterm.js terminal, which relays through PTY to nvim
  305 |   await page.locator('[data-testid="terminal"]').click();
  306 |   await page.keyboard.type('iL5_SENTINEL_CHARLIE');
  307 |   await page.keyboard.press('Escape');
  308 |   await page.waitForTimeout(1000);
```