import {
  spawn,
  ChildProcess,
  execFileSync,
  spawnSync,
} from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

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

export interface LaunchServerOptions {
  port?: number;
  configPath?: string;
}

export async function launchServer(
  filePath: string,
  options: LaunchServerOptions = {},
): Promise<ServerInstance> {
  const port = options.port ?? (await findFreePort());
  const absFilePath = resolve(filePath);
  const out: string[] = [];
  const err: string[] = [];
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;

  const proc = spawn(
    'npx',
    [
      'tsx',
      'server/cli.ts',
      absFilePath,
      '--no-open',
      '--port',
      String(port),
      ...(options.configPath ? ['--config', options.configPath] : []),
    ],
    {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, NO_OPEN: '1' },
      stdio: 'pipe',
    },
  );

  proc.stdout?.on('data', (d: Buffer) => out.push(d.toString()));
  proc.stderr?.on('data', (d: Buffer) => err.push(d.toString()));
  proc.once('exit', (code, signal) => {
    exitInfo = { code, signal };
  });

  const url = `http://localhost:${port}`;
  await waitForServer(url, 15000, () => {
    if (!exitInfo) return null;
    return new Error(
      `Server exited before readiness: code=${exitInfo.code} signal=${exitInfo.signal}\n` +
        `stdout:\n${out.join('')}\nstderr:\n${err.join('')}`,
    );
  });

  // Fetch the socket path and nvim PID from the server status endpoint
  const statusRes = await fetch(`${url}/api/status`);
  if (!statusRes.ok) {
    throw new Error(`Failed to get server status: ${statusRes.status} ${statusRes.statusText}`);
  }
  const status = (await statusRes.json()) as {
    pid: number;
    socket: string;
    file: string;
  };
  if (!status.socket) {
    throw new Error('Server status response missing socket path');
  }
  if (status.file !== absFilePath) {
    throw new Error(`Server status file mismatch: expected ${absFilePath}, got ${status.file}`);
  }

  return {
    port,
    process: proc,
    filePath: absFilePath,
    url,
    socketPath: status.socket,
    nvimPid: status.pid,
    out,
    err,
  };
}

async function waitForServer(
  url: string,
  timeoutMs: number,
  getEarlyFailure: () => Error | null = () => null,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const earlyFailure = getEarlyFailure();
    if (earlyFailure) throw earlyFailure;
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

async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolvePort(address.port);
        } else {
          reject(new Error('Unable to allocate a free TCP port'));
        }
      });
    });
  });
}

export function nvimDirectRPC(socketPath: string, expr: string): string {
  const stdout = execFileSync('nvim', ['--server', socketPath, '--remote-expr', expr], {
    encoding: 'utf-8',
    timeout: 5000,
  });
  return stdout.trim();
}

export async function waitForNvimReady(
  socketPath: string,
  timeoutMs = 10000,
): Promise<void> {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      if (nvimDirectRPC(socketPath, '1') === '1') return;
    } catch (err: any) {
      lastErr = err?.stderr || err?.message || String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nvim socket ${socketPath} not ready after ${timeoutMs}ms: ${lastErr}`);
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
  const proc = instance.process;
  if (proc.exitCode !== null || proc.signalCode !== null) return;

  const exited = new Promise<void>((resolveExit) => {
    proc.once('exit', () => resolveExit());
  });

  const signaled = proc.kill('SIGTERM');
  if (!signaled && (proc.exitCode !== null || proc.signalCode !== null)) return;

  await Promise.race([
    exited,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Server pid ${proc.pid} did not exit after SIGTERM\n` +
                `stdout:\n${instance.out.join('')}\nstderr:\n${instance.err.join('')}`,
            ),
          ),
        5000,
      ),
    ),
  ]);
}
