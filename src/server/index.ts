import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = resolve(__dirname, '..', 'client');

export interface ServerConfig {
  pandocCommand: string;
  pandocArgs: string[];
  timeoutMs: number;
  port: number;
  host: string;
}

const DEFAULT_ARGS = [
  '-f',
  'markdown+tex_math_dollars+citations',
  '-t',
  'html',
  '--standalone',
  '--mathjax',
];

export function createApp(config: ServerConfig) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Serve static files from client directory
  app.use(express.static(CLIENT_DIR));

  // Pandoc render endpoint
  app.post<{ html: string; durationMs: number }>('/api/render', async (req, res) => {
    const { markdown } = req.body;
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown field is required' });
      return;
    }

    const result = await renderMarkdown(
      markdown,
      config.pandocCommand,
      config.pandocArgs,
      config.timeoutMs,
    );

    res.json({ html: result.html, durationMs: result.durationMs, ok: result.ok });
  });

  return app;
}

export function startServer(config: ServerConfig) {
  const app = createApp(config);
  app.listen(config.port, config.host, () => {
    const url = `http://${config.host}:${config.port}`;
    console.log(`pandoc-preview running at ${url}`);
  });
}

// Run directly
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  startServer({
    pandocCommand: 'pandoc',
    pandocArgs: DEFAULT_ARGS,
    timeoutMs: 30000,
    port,
    host: '127.0.0.1',
  });
}
