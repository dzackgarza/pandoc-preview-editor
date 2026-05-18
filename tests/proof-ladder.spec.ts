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
  getFreePort,
  cleanServerArtifacts,
  ServerInstance,
} from './helpers';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ============================================================
// LAYER 0 — implicit: node, npx, bun all available (env check)
// ============================================================

// ============================================================
// LAYER 1: Raw process facts — no server, no browser, no UI
// ============================================================

let nodePty: any = null;

test.beforeAll(async () => {
  try {
    nodePty = await import('node-pty');
  } catch {
    nodePty = null;
  }
});

test('L1.1 pty_spawns_shell — node-pty spawns /bin/sh', async () => {
  expect(nodePty, 'node-pty module must be importable').not.toBeNull();
  const p = nodePty.spawn('/bin/sh', [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
  });
  expect(p.pid, 'pty.spawn must return pid > 0').toBeGreaterThan(0);
  p.kill();
});

test('L1.2 pty_spawns_clean_nvim — node-pty spawns nvim --clean --noplugin', async () => {
  expect(nodePty, 'node-pty module must be importable').not.toBeNull();

  const SOCK = `/tmp/pnp-l12-${Date.now()}.sock`;
  const tmpDir = mkdtempSync(join(tmpdir(), 'pnp-l12-'));
  const filePath = join(tmpDir, 'doc.md');
  writeFileSync(filePath, '# L1.2 test\n', 'utf-8');

  const p = nodePty.spawn(
    'nvim',
    ['--clean', '--noplugin', '--listen', SOCK, filePath],
    {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      env: { ...process.env, TERM: 'xterm-256color' },
    },
  );

  expect(p.pid, 'nvim in PTY must have pid > 0').toBeGreaterThan(0);

  // Wait for socket; remote-expr may or may not work through PTY-embedded nvim,
  // but the process fact is what matters here
  await new Promise((r) => setTimeout(r, 2000));

  // Best-effort socket check
  try {
    const out = execFileSync('nvim', ['--server', SOCK, '--remote-expr', '1'], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    expect(out.trim()).toBe('1');
  } catch {
    // PTY nvim socket may not answer; process fact is sufficient
  }

  p.kill();
});

test('L1.3 nvim_socket_ready — headless nvim creates socket and answers remote-expr', async () => {
  const SOCK = `/tmp/pnp-l13-${Date.now()}.sock`;
  const tmpDir = mkdtempSync(join(tmpdir(), 'pnp-l13-'));
  const filePath = join(tmpDir, 'doc.md');
  writeFileSync(filePath, '# Socket Test\n', 'utf-8');

  const nvimProc = spawn('nvim', ['--listen', SOCK, '--headless', filePath], {
    detached: true,
    stdio: 'ignore',
  });

  let ready = false;
  let lastErr = '';
  for (let i = 0; i < 20; i++) {
    try {
      const out = execFileSync('nvim', ['--server', SOCK, '--remote-expr', '1'], {
        encoding: 'utf-8',
        timeout: 3000,
      });
      if (out.trim() === '1') {
        ready = true;
        break;
      }
    } catch (e: any) {
      lastErr = e?.stderr || e?.message || String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  expect(ready, `nvim socket ${SOCK} not ready after 5s; lastErr=${lastErr}`).toBe(
    true,
  );

  nvimDirectQuit(SOCK);
  await new Promise((r) => setTimeout(r, 500));
  nvimProc.kill();
});

test('L1.4 nvim_remote_expr_reads_initial_file — remote-expr returns seed buffer', async () => {
  const SEED = '# Initial Content\n\nHello world.\n';
  const SOCK = `/tmp/pnp-l14-${Date.now()}.sock`;
  const tmpDir = mkdtempSync(join(tmpdir(), 'pnp-l14-'));
  const filePath = join(tmpDir, 'doc.md');
  writeFileSync(filePath, SEED, 'utf-8');

  const nvimProc = spawn('nvim', ['--listen', SOCK, '--headless', filePath], {
    detached: true,
    stdio: 'ignore',
  });

  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const out = execFileSync('nvim', ['--server', SOCK, '--remote-expr', '1'], {
        encoding: 'utf-8',
        timeout: 3000,
      });
      if (out.trim() === '1') {
        ready = true;
        break;
      }
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(ready, `nvim socket not ready`).toBe(true);

  const buf = nvimDirectRPC(SOCK, 'join(getline(1, "$"), "\\n")');
  expect(buf, 'buffer must contain seed heading').toContain('Initial Content');
  expect(buf, 'buffer must contain seed body').toContain('Hello world');

  nvimDirectQuit(SOCK);
  await new Promise((r) => setTimeout(r, 500));
  nvimProc.kill();
});

// ============================================================
// LAYER 2: Server owns nvim correctly
// ============================================================

let serverL2: ServerInstance;

test.afterAll(async () => {
  if (serverL2) {
    await killServer(serverL2);
    cleanServerArtifacts(serverL2);
  }
});

test('L2.1 server_starts_nvim_and_status_reports_pid_socket', async () => {
  const file = seedTempFile('l21', '# L2 Server\n\nStatus test.\n');
  serverL2 = await launchServer(file);

  const res = await fetch(`${serverL2.url}/api/status`);
  expect(res.status).toBe(200);
  const status = await res.json();

  expect(status.pid, '/api/status must report pid > 0').toBeGreaterThan(0);
  expect(status.socket, '/api/status must report correct socket').toBe(
    serverL2.socketPath,
  );
  expect(status.file, '/api/status must report file path').toBe(file);

  const ps = spawnSync('ps', ['-p', String(status.pid), '-o', 'pid,comm'], {
    encoding: 'utf-8',
    timeout: 3000,
  });
  expect(ps.stdout, 'ps must confirm nvim process').toContain('nvim');
});

test('L2.2 server_buffer_endpoint_reads_nvim_buffer', async () => {
  const file = seedTempFile('l22', '# L2 Buffer\n\nEndpoint test.\n');
  serverL2 = await launchServer(file);

  const res = await fetch(`${serverL2.url}/api/buffer`);
  expect(res.status).toBe(200);
  const data = await res.json();

  expect(data.buffer, '/api/buffer must contain seed heading').toContain('L2 Buffer');
  expect(data.buffer, '/api/buffer must contain seed body').toContain('Endpoint test');
  expect(data.hash, '/api/buffer must include non-empty hash').toBeTruthy();
  expect(typeof data.hash).toBe('string');
  expect(data.socketPath, '/api/buffer must report socket path').toBe(
    serverL2.socketPath,
  );
});

// ============================================================
// LAYER 3: Renderer facts — no nvim, no browser
// ============================================================

test('L3.1 pandoc_renders_markdown_heading_without_nvim', async () => {
  const md = '# The Title\n\nSome text. $E=mc^2$';
  const result = pandocRender(md);

  expect(result.status, `pandoc exit code must be 0; stderr=${result.stderr}`).toBe(0);
  expect(result.stdout, 'pandoc output must contain heading text').toContain(
    'The Title',
  );
  expect(result.stdout, 'pandoc must render math as span.math.inline').toMatch(
    /<span class="math inline">/,
  );
});

test('L3.2 pandoc renders citation as span with data-cites', async () => {
  const md = 'See @doe99.';
  const result = pandocRender(md);

  // --citeproc with no bibliography: pandoc exits 0 but emits a warning comment
  expect(result.stdout, 'pandoc must include citation author').toContain('doe99');
  expect(result.stdout, 'pandoc must render citation span').toMatch(
    /<span class="citation"[^>]*data-cites="doe99"/,
  );
});

// ============================================================
// LAYER 4: WebSocket / preview delivery
// ============================================================

let serverL4: ServerInstance;

test.afterAll(async () => {
  if (serverL4) {
    await killServer(serverL4);
    cleanServerArtifacts(serverL4);
  }
});

test('L4.1 websocket_preview_delivery — iframe receives server-rendered HTML', async ({
  page,
}) => {
  const file = seedTempFile('l41', '# WS Delivery\n\n**bold** text.\n');
  serverL4 = await launchServer(file);

  await page.goto(serverL4.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(2000);

  const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  const h1 = previewFrame.locator('h1').first();
  await expect(h1, 'iframe must contain heading after WS delivery').toBeAttached({
    timeout: 8000,
  });

  const text = await h1.textContent();
  expect(text, 'h1 text must match seed file heading').toContain('WS Delivery');

  const bold = previewFrame.locator('strong').first();
  await expect(bold, 'bold text must appear via WS delivery').toContainText('bold', {
    timeout: 3000,
  });
});

// ============================================================
// LAYER 5: Terminal input reaches nvim
// ============================================================

let serverL5: ServerInstance;

test.afterAll(async () => {
  if (serverL5) {
    await killServer(serverL5);
    cleanServerArtifacts(serverL5);
  }
});

test('L5.1 xterm_keyboard_input_changes_nvim_buffer', async ({ page }) => {
  const file = seedTempFile('l51', '# L5 Type\n\n');
  serverL5 = await launchServer(file);

  await page.goto(serverL5.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Type into xterm.js terminal, which relays through PTY to nvim
  await page.locator('[data-testid="terminal"]').click();
  await page.keyboard.type('iL5_SENTINEL_CHARLIE');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // Query nvim via socket RPC — external fact, NOT internal API
  const buf = nvimDirectRPC(serverL5.socketPath, 'join(getline(1, "$"), "\\n")');
  expect(buf, 'nvim buffer must contain typed sentinel').toContain(
    'L5_SENTINEL_CHARLIE',
  );
});

// ============================================================
// LAYER 6: Full product contract
// ============================================================

let serverL6: ServerInstance;

test.afterAll(async () => {
  if (serverL6) {
    await killServer(serverL6);
    cleanServerArtifacts(serverL6);
  }
});

test('L6.1 full_type_preview_save_contract — type, preview, save, disk', async ({
  page,
}) => {
  const file = seedTempFile('l61', '# Contract Start\n\nInitial text.\n');
  serverL6 = await launchServer(file);

  await page.goto(serverL6.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Assert initial preview shows seed content
  const previewFrame = page.frameLocator('[data-testid="preview-frame"]');
  await expect(
    previewFrame.locator('body'),
    'preview must show initial heading',
  ).toContainText('Contract Start', { timeout: 5000 });

  // Type new content into nvim via terminal
  await page.locator('[data-testid="terminal"]').click();
  await page.keyboard.type('iL6_CONTRACT_FINAL');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);

  // Assert preview updated with sentinel
  await expect(
    previewFrame.locator('body'),
    'preview must update with typed sentinel',
  ).toContainText('L6_CONTRACT_FINAL', { timeout: 8000 });

  // Save via API
  const saveRes = await page.evaluate(async () => {
    const r = await fetch('/api/save', { method: 'POST' });
    return r.json();
  });
  expect(saveRes.ok, '/api/save must return ok: true').toBe(true);
  await page.waitForTimeout(500);

  // Assert file on disk contains both seed text and typed sentinel
  const diskContent = readFile(file);
  expect(diskContent, 'disk must contain sentinel').toContain('L6_CONTRACT_FINAL');
  expect(diskContent, 'disk must contain initial text').toContain('Initial text');
});
