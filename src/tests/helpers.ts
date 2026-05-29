import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

export interface ServerInstance {
  port: number;
  process: ChildProcess;
  url: string;
  out: string[];
  err: string[];
  tempHome?: string;
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
          reject(new Error('Unable to allocate free TCP port'));
        }
      });
    });
  });
}

export async function launchServer(
  port?: number,
  file?: string,
  configPath?: string,
): Promise<ServerInstance> {
  const p = port ?? (await findFreePort());
  const out: string[] = [];
  const err: string[] = [];

  const tempHome = mkdtempSync(join(tmpdir(), 'pandoc-test-home-'));

  const args = ['tsx', 'src/server/cli.ts', '--port', String(p)];
  if (configPath) args.push('--config', configPath);
  if (file) args.push(file);

  const proc = spawn('npx', args, {
    cwd: ROOT,
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      XDG_CONFIG_HOME: join(tempHome, '.config'),
      XDG_STATE_HOME: join(tempHome, '.local', 'state'),
    },
  });

  proc.stdout?.on('data', (d: Buffer) => out.push(d.toString()));
  proc.stderr?.on('data', (d: Buffer) => err.push(d.toString()));

  const url = `http://localhost:${p}`;
  await waitForServer(url, 30000);

  return { port: p, process: proc, url, out, err, tempHome };
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: '# ping' }),
      });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server at " + url + " not ready within " + timeoutMs + "ms");
}

export async function killServer(instance: ServerInstance): Promise<void> {
  const proc = instance.process;
  if (proc.exitCode !== null || proc.signalCode !== null) {
    if (instance.tempHome) {
      try {
        rmSync(instance.tempHome, { recursive: true, force: true });
      } catch (err) {
        console.error(`Failed to delete tempHome: ${err}`);
      }
    }
    return;
  }

  const exited = new Promise<void>((resolveExit) => {
    proc.once('exit', () => resolveExit());
  });

  proc.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Server pid ${proc.pid} did not exit after SIGTERM`)),
        5000,
      ),
    ),
  ]);

  if (instance.tempHome) {
    try {
      rmSync(instance.tempHome, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to delete tempHome: ${err}`);
    }
  }
}
