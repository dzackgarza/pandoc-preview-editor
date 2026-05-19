import { spawnNvim, type NvimPTY } from './pty.js';
import { getBuffer, saveBuffer, pollReady } from './nvim-rpc.js';
import { createWSServer, broadcast } from './ws.js';
import { renderMarkdown } from './render.js';
import type { PreviewConfig } from './config.js';
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import open from 'open';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, '..', 'web');

const RUN_ROOT = join(tmpdir(), 'pandoc-nvim-preview');

interface AppConfig {
  filePath: string;
  port: number;
  previewConfig: PreviewConfig;
}

interface RenderRequest {
  seq: number;
  buffer: string;
  hash: string;
}

export async function startServer(config: AppConfig) {
  const runDir = join(RUN_ROOT, `port-${config.port}`);
  const socketPath = join(runDir, 'nvim.sock');

  if (!existsSync(runDir)) {
    mkdirSync(runDir, { recursive: true });
  }

  // Remove only this server's stale socket path.
  if (existsSync(socketPath)) {
    rmSync(socketPath);
  }

  const absFilePath = resolve(config.filePath);
  const renderState = createRenderState(config.previewConfig.render.debounceMs);
  let latestBuffer = '';
  process.env.PANDOC_PREVIEW_DEBOUNCE_MS = String(
    config.previewConfig.render.debounceMs,
  );

  // nvim starts when the first WS client connects (not at boot),
  // so all PTY output goes directly to a real listener
  let nvim: NvimPTY | null = null;

  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  const wss = createWSServer(httpServer);

  // Serve static files from web/
  app.use(express.static(WEB_DIR));
  app.use('/dist', express.static(resolve(WEB_DIR, 'dist')));

  // Serve @xterm/xterm css
  app.use(
    '/xterm',
    express.static(resolve(__dirname, '..', 'node_modules', '@xterm', 'xterm', 'css')),
  );

  // Save endpoint: send :w, verify
  app.post('/api/save', async (_req, res) => {
    try {
      await saveBuffer(socketPath);
      const content = readFileSync(absFilePath, 'utf-8');
      res.json({ ok: true, bytes: content.length });
    } catch (err: any) {
      console.error('[pandoc-nvim-preview] save error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Current nvim buffer (for diagnostics)
  app.get('/api/buffer', async (_req, res) => {
    try {
      const buffer = await getBuffer(socketPath);
      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      res.json({ buffer, hash, socketPath });
    } catch (err: any) {
      console.error('[pandoc-nvim-preview] buffer error:', err.message);
      res.status(500).json({ error: err.message, socketPath });
    }
  });

  // Health check
  app.get('/api/status', (_req, res) => {
    res.json({
      pid: nvim?.pid ?? 0,
      socket: socketPath,
      file: absFilePath,
      configPath: config.previewConfig.configPath,
    });
  });

  app.get('/api/render-status', (_req, res) => {
    res.json(renderState.snapshot());
  });

  // Buffer update from nvim plugin (push-based, no polling)
  app.post(
    '/api/buffer-update',
    express.text({ type: '*/*', limit: '10mb' }),
    (req, res) => {
      const buffer = req.body;
      latestBuffer = buffer;
      console.log(
        `[pandoc-nvim-preview] buffer-update received (${buffer.length} chars)`,
      );
      enqueueRender(buffer);
      res.status(202).end();
    },
  );

  // WebSocket: spawn nvim on first connection, handle client messages
  let nvimSpawned = false;
  wss.on('connection', (ws) => {
    if (!nvimSpawned) {
      nvimSpawned = true;
      nvim = spawnNvim(absFilePath, socketPath, config.port);
      console.log(`[pandoc-nvim-preview] Starting nvim for ${absFilePath}`);
      nvim.onData((data: string) => {
        broadcast({ type: 'pty-output', data });
      });
      // Don't block connect — nvim spawns asynchronously
      pollReady(socketPath).then((ready) => {
        if (ready) {
          console.log(`[pandoc-nvim-preview] Neovim ready (pid ${nvim!.pid})`);
        } else {
          console.error('[pandoc-nvim-preview] Neovim failed to start within timeout');
        }
      });
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          data?: string;
          cols?: number;
          rows?: number;
        };
        if (msg.type === 'pty-input' && msg.data) {
          nvim?.write(msg.data);
        } else if (msg.type === 'pty-resize' && msg.cols && msg.rows) {
          nvim?.resize(msg.cols, msg.rows);
        } else if (msg.type === 'refresh-preview' && latestBuffer) {
          enqueueRender(latestBuffer, true);
        }
      } catch (parseErr: any) {
        console.error(
          '[pandoc-nvim-preview] WS parse error:',
          parseErr?.message || parseErr,
        );
      }
    });
  });

  // Cleanup on exit
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try {
      wss.close();
    } catch {}
    try {
      httpServer.close();
    } catch {}
    try {
      nvim?.kill();
    } catch {}
    try {
      if (existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
    } catch {}
  }

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('uncaughtException', (err) => {
    console.error('[pandoc-nvim-preview] uncaught exception:', err);
    cleanup();
    process.exit(1);
  });

  // Start HTTP server — browser connects on its own via WS
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.port, () => {
      console.log(`[pandoc-nvim-preview] Server on http://localhost:${config.port}`);
      resolve();
    });
    httpServer.on('error', reject);
  });

  // nvim is NOT spawned here — it spawns when the first WS client connects.
  // This ensures all PTY output goes directly to a real listener.

  if (process.env.NO_OPEN !== '1') {
    try {
      await open(`http://localhost:${config.port}`);
    } catch {
      console.log(
        `[pandoc-nvim-preview] Open http://localhost:${config.port} in your browser`,
      );
    }
  }

  function enqueueRender(buffer: string, force = false): void {
    const seq = renderState.nextSeq();
    const hash = createHash('sha256').update(buffer).digest('hex');
    renderState.queue({ seq, buffer, hash });
    broadcast({
      type: 'preview-status',
      state: 'queued',
      seq,
      pendingSeq: renderState.pendingSeq(),
    });
    scheduleRender(force ? 0 : config.previewConfig.render.debounceMs);
  }

  function scheduleRender(delayMs: number): void {
    renderState.schedule(delayMs, () => {
      void drainRenderQueue();
    });
  }

  async function drainRenderQueue(): Promise<void> {
    const request = renderState.takeNext();
    if (!request) return;

    if (request.hash === renderState.lastCompletedHash()) {
      renderState.skip(request);
      broadcast({
        type: 'preview-status',
        state: 'skipped',
        seq: request.seq,
        pendingSeq: renderState.pendingSeq(),
      });
      if (renderState.hasPending()) scheduleRender(0);
      return;
    }

    renderState.start(request);
    broadcast({
      type: 'preview-status',
      state: 'rendering',
      seq: request.seq,
      pendingSeq: renderState.pendingSeq(),
    });

    const result = await renderMarkdown(request.buffer, {
      command: config.previewConfig.pandoc.command,
      args: config.previewConfig.pandoc.args,
      timeoutMs: config.previewConfig.render.timeoutMs,
    });
    renderState.complete(request, result.durationMs);
    console.log(
      `[pandoc-nvim-preview] preview rendered seq ${request.seq} ` +
        `(${result.html.length} chars, ${result.durationMs}ms)`,
    );
    broadcast({
      type: 'preview-update',
      html: result.html,
      seq: request.seq,
      sourceHash: request.hash,
      renderTimeMs: result.durationMs,
      ok: result.ok,
      skippedPending: renderState.hasPending(),
    });

    if (renderState.hasPending()) {
      scheduleRender(0);
    } else {
      broadcast({
        type: 'preview-status',
        state: 'idle',
        seq: request.seq,
        pendingSeq: null,
      });
    }
  }
}

function createRenderState(debounceMs: number) {
  let seq = 0;
  let pending: RenderRequest | null = null;
  let active: RenderRequest | null = null;
  let timer: NodeJS.Timeout | null = null;
  let completedHash = '';
  const stats = {
    debounceMs,
    received: 0,
    started: 0,
    completed: 0,
    skippedUnchanged: 0,
    latestSeq: 0,
    runningSeq: null as number | null,
    pendingSeq: null as number | null,
    completedSeq: null as number | null,
    lastRenderTimeMs: null as number | null,
    lastCompletedHash: '',
  };

  return {
    nextSeq(): number {
      seq++;
      stats.received++;
      stats.latestSeq = seq;
      return seq;
    },
    queue(request: RenderRequest): void {
      pending = request;
      stats.pendingSeq = request.seq;
    },
    schedule(delayMs: number, callback: () => void): void {
      if (timer) clearTimeout(timer);
      if (active) return;
      timer = setTimeout(() => {
        timer = null;
        callback();
      }, delayMs);
    },
    takeNext(): RenderRequest | null {
      if (active || !pending) return null;
      const request = pending;
      pending = null;
      stats.pendingSeq = null;
      return request;
    },
    start(request: RenderRequest): void {
      active = request;
      stats.started++;
      stats.runningSeq = request.seq;
    },
    complete(request: RenderRequest, durationMs: number): void {
      active = null;
      completedHash = request.hash;
      stats.completed++;
      stats.runningSeq = null;
      stats.completedSeq = request.seq;
      stats.lastRenderTimeMs = durationMs;
      stats.lastCompletedHash = request.hash;
    },
    skip(request: RenderRequest): void {
      stats.skippedUnchanged++;
      stats.completedSeq = request.seq;
    },
    lastCompletedHash(): string {
      return completedHash;
    },
    hasPending(): boolean {
      return pending !== null;
    },
    pendingSeq(): number | null {
      return pending?.seq ?? null;
    },
    snapshot() {
      return {
        ...stats,
        inFlight: active !== null,
        queued: pending !== null,
      };
    },
  };
}
