import {
  spawn,
  ChildProcess,
  execFileSync,
  spawnSync,
} from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PORT = 3141;

export function seedTempFile(slug: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pnp-${slug}-`));
  const path = join(dir, 'doc.md');
  writeFileSync(path, content, 'utf-8');
  return path;
}

export function readFile(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export interface ServerInstance {
  port: number;
  process: ChildProcess;
  filePath: string;
  url: string;
  socketPath: string;
  nvimPid: number;
  out: string[];
  err: string[];
}

export async function launchServer(filePath: string): Promise<ServerInstance> {
  const out: string[] = [];
  const err: string[] = [];

  const proc = spawn(
    'npx',
    ['tsx', 'server/cli.ts', filePath, '--no-open'],
    {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, NO_OPEN: '1' },
      stdio: 'pipe',
    },
  );

  proc.stdout?.on('data', (d: Buffer) => out.push(d.toString()));
  proc.stderr?.on('data', (d: Buffer) => err.push(d.toString()));

  const url = `http://localhost:${PORT}`;
  await waitForServer(url, 15000);

  // Fetch the socket path and nvim PID from the server status endpoint
  const statusRes = await fetch(`${url}/api/status`);
  if (!statusRes.ok) {
    throw new Error(`Failed to get server status: ${statusRes.status} ${statusRes.statusText}`);
  }
  const status = (await statusRes.json()) as { pid: number; socket: string };
  if (!status.socket) {
    throw new Error('Server status response missing socket path');
  }

  return {
    port: PORT,
    process: proc,
    filePath,
    url,
    socketPath: status.socket,
    nvimPid: status.pid,
    out,
    err,
  };
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} not ready within ${timeoutMs}ms`);
}

export function nvimDirectRPC(socketPath: string, expr: string): string {
  const stdout = execFileSync('nvim', ['--server', socketPath, '--remote-expr', expr], {
    encoding: 'utf-8',
    timeout: 5000,
  });
  return stdout.trim();
}

export function nvimDirectSend(socketPath: string, keys: string): void {
  execFileSync('nvim', ['--server', socketPath, '--remote-send', keys], {
    timeout: 5000,
  });
}

export function nvimDirectQuit(socketPath: string): void {
  try {
    execFileSync('nvim', ['--server', socketPath, '--remote-send', ':qa!<CR>'], {
      timeout: 3000,
    });
  } catch {
    // already gone
  }
}

export interface PandocResult {
  stdout: string;
  stderr: string;
  status: number | null;
  argv: string[];
}

export function pandocRender(markdown: string): PandocResult {
  const args = [
    '-f',
    'markdown+tex_math_dollars+citations',
    '-t',
    'html',
    '--standalone',
    '--mathjax',
    '--citeproc',
  ];

  const result = spawnSync('pandoc', args, {
    input: markdown,
    encoding: 'utf-8',
    timeout: 5000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    stdout: result.stdout?.trim() || '',
    stderr: (result.stderr || '').trim(),
    status: result.status ?? null,
    argv: ['pandoc', ...args],
  };
}

export async function killServer(instance: ServerInstance): Promise<void> {
  instance.process.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  try {
    instance.process.kill('SIGKILL');
  } catch {
    // already exited
  }
}
