import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;

function fitAndNotify(): void {
  if (!fitAddon || !terminal) return;
  try {
    fitAddon.fit();
  } catch {
    // container may not be visible yet
  }
}

export function createTerminal(
  container: HTMLElement,
  onInput: (data: string) => void,
  onResize: (cols: number, rows: number) => void,
): Terminal {
  terminal = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#45475a',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
    fontFamily:
      "'JetBrainsMono Nerd Font Mono', 'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'monospace', 'Menlo', 'Monaco', 'Courier New'",
    fontSize: 14,
    allowProposedApi: true,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);

  // Deferred initial fit — layout may not be settled at open()
  requestAnimationFrame(() => fitAndNotify());

  // Observe container resizes (handles panel splits, window resize, tab switches)
  resizeObserver = new ResizeObserver(() => fitAndNotify());
  resizeObserver.observe(container);

  terminal.onData(onInput);

  terminal.onResize((size: { cols: number; rows: number }) => {
    onResize(size.cols, size.rows);
  });

  container.setAttribute('data-active', 'true');

  return terminal;
}

export function disposeTerminal(): void {
  resizeObserver?.disconnect();
  resizeObserver = null;
  terminal?.dispose();
  terminal = null;
  fitAddon = null;
}

export function writeToTerminal(data: string): void {
  terminal?.write(data);
}

export function fitTerminal(): void {
  fitAddon?.fit();
}
