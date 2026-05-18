import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';

export type ServerMessage =
  | { type: 'pty-output'; data: string }
  | { type: 'preview-update'; html: string };

export type ClientMessage = { type: 'pty-input'; data: string };

let wss: WebSocketServer | null = null;

export function createWSServer(httpServer: Server): WebSocketServer {
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
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
  if (!wss) return;
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
