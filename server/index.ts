import { spawnNvim } from './pty.js';
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

const RUN_DIR = join(tmpdir(), 'pandoc-nvim-preview');
const SOCKET_PATH = join(RUN_DIR, 'nvim.sock');

interface AppConfig {
  filePath: string;
  port: number;
  bibliography?: string;
  csl?: string;
  katex?: boolean;
}

export async function startServer(config: AppConfig) {
  if (!existsSync(RUN_DIR)) {
    mkdirSync(RUN_DIR, { recursive: true });
  }

  // Remove stale socket
  if (existsSync(SOCKET_PATH)) {
    rmSync(SOCKET_PATH);
  }

  const absFilePath = resolve(config.filePath);

  console.log(`[pandoc-nvim-preview] Starting nvim for ${absFilePath}`);
  const nvim = spawnNvim(absFilePath, SOCKET_PATH);

  console.log(`[pandoc-nvim-preview] Waiting for nvim to be ready...`);
  const ready = await pollReady(SOCKET_PATH);
  if (!ready) {
    nvim.kill();
    throw new Error('Neovim failed to start within timeout');
  }
  console.log(`[pandoc-nvim-preview] Neovim ready (pid ${nvim.pid})`);

  // Global PTY listener - broadcast to all clients (ONE listener, not one per client)
  nvim.onData((data: string) => {
    broadcast({ type: 'pty-output', data });
  });

  // Poll buffer and broadcast preview updates
  let lastBuffer = '';
  const previewInterval = setInterval(async () => {
    try {
      const buffer = await getBuffer(SOCKET_PATH);
      if (buffer !== lastBuffer) {
        lastBuffer = buffer;
        const html = renderMarkdown(buffer, {
          bibliography: config.bibliography,
          csl: config.csl,
          katex: config.katex,
        });
        broadcast({ type: 'preview-update', html });
      }
    } catch (err: any) {
      // Expected during startup or shutdown - only log if unexpected
      if (err.code !== 'ECONNREFUSED' && err.code !== 'ENOENT') {
        console.error('[pandoc-nvim-preview] preview poll error:', err.message);
      }
    }
  }, 500);

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

  // Save endpoint: query buffer, send :w, verify
  app.post('/api/save', async (_req, res) => {
    try {
      await saveBuffer(SOCKET_PATH);
      // Verify file was written by reading it back
      const content = readFileSync(absFilePath, 'utf-8');
      res.json({ ok: true, bytes: content.length });
    } catch (err: any) {
      console.error('[pandoc-nvim-preview] save error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Current nvim buffer (for certification layer diagnostics)
  app.get('/api/buffer', async (_req, res) => {
    try {
      const buffer = await getBuffer(SOCKET_PATH);
      const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      res.json({ buffer, hash, socketPath: SOCKET_PATH });
    } catch (err: any) {
      console.error('[pandoc-nvim-preview] buffer error:', err.message);
      res.status(500).json({ error: err.message, socketPath: SOCKET_PATH });
    }
  });

  // Health check
  app.get('/api/status', (_req, res) => {
    res.json({ pid: nvim.pid, socket: SOCKET_PATH, file: absFilePath });
  });

  // WebSocket: handle client messages + send initial preview
  wss.on('connection', async (ws) => {
    // Send initial preview update on connection
    try {
      const buffer = await getBuffer(SOCKET_PATH);
      const html = renderMarkdown(buffer, {
        bibliography: config.bibliography,
        csl: config.csl,
        katex: config.katex,
      });
      ws.send(JSON.stringify({ type: 'preview-update', html }));
    } catch (err: any) {
      console.error('[pandoc-nvim-preview] initial preview error:', err.message);
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
          nvim.write(msg.data);
        } else if (msg.type === 'pty-resize' && msg.cols && msg.rows) {
          nvim.resize(msg.cols, msg.rows);
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
  function cleanup() {
    clearInterval(previewInterval);
    nvim.kill();
    if (existsSync(SOCKET_PATH)) {
      rmSync(SOCKET_PATH);
    }
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return new Promise<void>((resolve, reject) => {
    httpServer.listen(config.port, async () => {
      console.log(`[pandoc-nvim-preview] Server on http://localhost:${config.port}`);

      if (process.env.NO_OPEN !== '1') {
        try {
          await open(`http://localhost:${config.port}`);
        } catch {
          console.log(
            `[pandoc-nvim-preview] Open http://localhost:${config.port} in your browser`,
          );
        }
      }

      resolve();
    });

    httpServer.on('error', reject);
  });
}
