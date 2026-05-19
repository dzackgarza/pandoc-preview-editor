import { spawnNvim, type NvimPTY } from './pty.js';
import { getBuffer, saveBuffer, pollReady } from './nvim-rpc.js';
import { createWSServer, broadcast } from './ws.js';
import { renderMarkdown } from './render.js';
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
  bibliography?: string;
  csl?: string;
  katex?: boolean;
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
    res.json({ pid: nvim?.pid ?? 0, socket: socketPath, file: absFilePath });
  });

  // Buffer update from nvim plugin (push-based, no polling)
  app.post(
    '/api/buffer-update',
    express.text({ type: '*/*', limit: '10mb' }),
    (req, res) => {
      const buffer = req.body;
      console.log(
        `[pandoc-nvim-preview] buffer-update received (${buffer.length} chars)`,
      );
      const html = renderMarkdown(buffer, {
        bibliography: config.bibliography,
        csl: config.csl,
        katex: config.katex,
      });
      console.log(`[pandoc-nvim-preview] preview rendered (${html.length} chars)`);
      broadcast({ type: 'preview-update', html });
      res.status(200).end();
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
}
