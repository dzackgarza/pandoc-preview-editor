import { createTerminal, writeToTerminal, fitTerminal } from './TerminalPane.js';
import { createPreview, updatePreview } from './PreviewPane.js';

const statusEl = document.getElementById('status')!;
const terminalContainer = document.getElementById('terminal-pane')!;
const previewFrame = document.getElementById('preview-frame') as HTMLIFrameElement;
const saveBtn = document.getElementById('save-btn')!;

// Determine WebSocket URL from current page
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${location.host}`;

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'var(--error)' : 'var(--accent)';
}

function connect(): WebSocket {
  setStatus('connecting...');
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus('connected');
    createPreview(previewFrame);

    const term = createTerminal(
      terminalContainer,
      (data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pty-input', data }));
        }
      },
      (cols: number, rows: number) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pty-resize', cols, rows }));
        }
      },
    );
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'pty-output') {
        writeToTerminal(msg.data);
      } else if (msg.type === 'preview-update') {
        updatePreview(msg.html);
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    setStatus('disconnected — reload the page', true);
  };

  ws.onerror = () => {
    setStatus('connection error', true);
  };

  return ws;
}

// Save button
saveBtn.addEventListener('click', async () => {
  try {
    setStatus('saving...');
    const res = await fetch('/api/save', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      setStatus(`saved (${data.bytes}B)`);
    } else {
      setStatus(`save error: ${data.error}`, true);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`save error: ${msg}`, true);
  }
});

// Handle window resize
window.addEventListener('resize', () => {
  fitTerminal();
});

// Start
connect();
