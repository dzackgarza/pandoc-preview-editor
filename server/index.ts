import { spawnNvim } from './pty.js';
import { getBuffer, saveBuffer, pollReady } from './nvim-rpc.js';
import { renderMarkdown } from './render.js';
import { createWSServer, broadcast } from './ws.js';
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

  // Buffer PTY output for clients that connect after startup
  const ptyBuffer: string[] = [];
  nvim.onData((data: string) => {
    ptyBuffer.push(data);
    // Trim buffer to avoid unbounded growth
    if (ptyBuffer.length > 100) ptyBuffer.shift();
  });

  console.log(`[pandoc-nvim-preview] Waiting for nvim to be ready...`);
  const ready = await pollReady(SOCKET_PATH);
  if (!ready) {
    nvim.kill();
    throw new Error('Neovim failed to start within timeout');
  }
  console.log(`[pandoc-nvim-preview] Neovim ready (pid ${nvim.pid})`);

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

  // WebSocket: relay PTY I/O + handle client messages
  wss.on('connection', (ws) => {
    const onPtyData = (data: string) => {
      broadcast({ type: 'pty-output', data });
    };

    nvim.onData(onPtyData);

    // Replay buffered PTY output so the client sees the nvim startup screen
    for (const chunk of ptyBuffer) {
      ws.send(JSON.stringify({ type: 'pty-output', data: chunk }));
    }

    // Replay current preview HTML (pollOnce fires before WS connect)
    if (lastRenderedHtml) {
      ws.send(JSON.stringify({ type: 'preview-update', html: lastRenderedHtml }));
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

    ws.on('close', () => {
      // listener stays; we just stop forwarding to this client
    });
  });

  // Poll loop: get buffer -> render -> broadcast preview
  let pollTimer: NodeJS.Timeout | null = null;
  let lastContent = '';
  let lastRenderedHtml = '';

  async function pollOnce() {
    try {
      const buffer = await getBuffer(SOCKET_PATH);
      if (buffer === lastContent) return;
      lastContent = buffer;

      let html: string;
      try {
        html = renderMarkdown(buffer, {
          bibliography: config.bibliography,
          csl: config.csl,
          katex: config.katex,
        });
      } catch (renderErr: any) {
        console.error('[pandoc-nvim-preview] render error:', renderErr.message);
        html = `<!-- render error: ${renderErr.message} -->`;
      }

      broadcast({ type: 'preview-update', html });
      lastRenderedHtml = html;
    } catch (pollErr) {
      console.error(
        '[pandoc-nvim-preview] poll error:',
        pollErr instanceof Error ? pollErr.message : String(pollErr),
      );
    }
  }

  function startPolling() {
    // Run once immediately, then on interval
    pollOnce();
    pollTimer = setInterval(pollOnce, 300);
  }

  // Cleanup on exit
  function cleanup() {
    if (pollTimer) clearInterval(pollTimer);
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
      startPolling();

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
