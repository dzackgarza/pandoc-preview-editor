import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';

export interface NvimPTY {
  ptyProcess: pty.IPty;
  pid: number;
  socketPath: string;
  onData: (cb: (data: string) => void) => void;
  removeListener: (cb: (data: string) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export function spawnNvim(filePath: string, socketPath: string, port: number): NvimPTY {
  const [nvimCmd, ...nvimArgs] = process.env.NVIM ? [process.env.NVIM] : ['nvim'];

  const ptyProcess = pty.spawn(nvimCmd, ['--listen', socketPath, filePath], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      PANDOC_PREVIEW_PORT: port.toString(),
    },
  });

  const listeners: Array<(data: string) => void> = [];

  ptyProcess.onData((data: string) => {
    for (const cb of listeners) cb(data);
  });

  return {
    ptyProcess,
    pid: ptyProcess.pid,
    socketPath,
    onData(cb: (data: string) => void) {
      listeners.push(cb);
    },
    removeListener(cb: (data: string) => void) {
      const idx = listeners.indexOf(cb);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    write(data: string) {
      ptyProcess.write(data);
    },
    resize(cols: number, rows: number) {
      ptyProcess.resize(cols, rows);
    },
    kill() {
      ptyProcess.kill();
    },
  };
}
