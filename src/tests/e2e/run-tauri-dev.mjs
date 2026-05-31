#!/usr/bin/env node
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const socketPath = process.env.TAURI_PLAYWRIGHT_SOCKET ?? '/tmp/tauri-playwright.sock';

function sendEval() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(JSON.stringify({ type: 'eval', script: 'document.readyState' }) + '\n');
    });
    socket.on('data', (chunk) => {
      data += chunk;
      if (!data.includes('\n')) return;
      socket.end();
      try {
        const response = JSON.parse(data.trim());
        if (response.ok) {
          resolve();
        } else {
          reject(new Error(response.error ?? 'Tauri eval readiness probe failed'));
        }
      } catch (error) {
        reject(error);
      }
    });
    socket.on('error', reject);
  });
}

async function waitForWindow() {
  const deadline = Date.now() + 30000;
  let lastError = new Error('Tauri window readiness probe did not run');
  while (Date.now() < deadline) {
    try {
      await sendEval();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

function pipeWithReadiness(stream, write) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.includes('tauri-plugin-playwright: listening on unix:')) {
        waitForWindow()
          .then(() => write(line + '\n'))
          .catch((error) => {
            console.error(error);
            child.kill('SIGTERM');
          });
      } else {
        write(line + '\n');
      }
    }
  });
  stream.on('end', () => {
    if (buffer.length > 0) write(buffer);
  });
}

const child = spawn('npx', ['tauri', 'dev', ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: path.join(scriptDir, 'xdg-config'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

pipeWithReadiness(child.stdout, (line) => process.stdout.write(line));
pipeWithReadiness(child.stderr, (line) => process.stderr.write(line));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
