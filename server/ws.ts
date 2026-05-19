import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';

export type ServerMessage =
  | { type: 'pty-output'; data: string }
  | { type: 'preview-update'; html: string };

export type ClientMessage = { type: 'pty-input'; data: string };

let wss: WebSocketServer | null = null;
let lastPreviewHtml: string | null = null;

export function createWSServer(httpServer: Server): WebSocketServer {
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    // Send cached preview to new clients so they see content immediately
    if (lastPreviewHtml !== null) {
      console.log(
        `[pandoc-nvim-preview] WS: sending cached preview (${lastPreviewHtml.length} chars)`,
      );
      ws.send(JSON.stringify({ type: 'preview-update', html: lastPreviewHtml }));
    } else {
      console.log('[pandoc-nvim-preview] WS: no cached preview available');
    }

    ws.on('message', (_raw) => {
      // parse handled by caller via the ws.on('connection') hook
    });

    ws.on('error', () => {
      // ignore connection errors, cleanup handled by close
    });
  });

  return wss;
}

export function broadcast(msg: ServerMessage): void {
  if (!wss) {
    console.log('[pandoc-nvim-preview] broadcast: wss is null, skipping');
    return;
  }

  // Cache the latest preview HTML for new clients
  if (msg.type === 'preview-update') {
    console.log(
      `[pandoc-nvim-preview] broadcast: caching preview-update (${msg.html.length} chars)`,
    );
    lastPreviewHtml = msg.html;
  }

  const payload = JSON.stringify(msg);
  let sent = 0;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      sent++;
    }
  }
  console.log(`[pandoc-nvim-preview] broadcast: sent ${msg.type} to ${sent} clients`);
}
