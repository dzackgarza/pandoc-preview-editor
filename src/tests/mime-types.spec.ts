import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

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

test.describe('Production Static Asset Resolution MIME Safety', () => {
  let tempCwd: string;
  const cliPath = resolve(process.cwd(), 'src/server/cli.ts');

  test.beforeEach(() => {
    tempCwd = mkdtempSync(join(tmpdir(), 'pandoc-test-cwd-'));
  });

  test.afterEach(() => {
    rmSync(tempCwd, { recursive: true, force: true });
  });

  test('should serve compiled production scripts with correct MIME type when launched from any directory', async () => {
    const port = await findFreePort();
    
    // Spawn server inside tempCwd (mimicking launching from user notes/doc folder)
    const proc = spawn('npx', ['tsx', cliPath, '--port', String(port)], {
      cwd: tempCwd,
      env: {
        ...process.env,
      },
    });

    const out: string[] = [];
    const err: string[] = [];
    proc.stdout?.on('data', (d) => out.push(d.toString()));
    proc.stderr?.on('data', (d) => err.push(d.toString()));

    await new Promise<void>((resolveWait, reject) => {
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error(`Server startup timed out. stdout: ${out.join('')}, stderr: ${err.join('')}`));
      }, 10000);

      proc.stdout?.on('data', (d) => {
        if (d.toString().includes('pandoc-preview running at')) {
          clearTimeout(timeout);
          resolveWait();
        }
      });
      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(`CLI exited early with code ${code}. stderr: ${err.join('')}`));
        }
      });
    });

    try {
      // 1. Fetch index page
      const indexRes = await fetch(`http://localhost:${port}/`);
      expect(indexRes.ok).toBe(true);
      const html = await indexRes.text();

      // 2. Extract script src from index.html
      const scriptMatch = html.match(/<script type="module"[^>]*src="([^"]+)"/);
      expect(scriptMatch).not.toBeNull();
      const scriptSrc = scriptMatch![1];

      // Under the bug, the scriptSrc will be "/main.tsx" (source mode) instead of compiled assets "/assets/index-*.js"
      expect(scriptSrc).not.toContain('.tsx');
      expect(scriptSrc).toContain('/assets/index');

      // 3. Fetch the script
      const scriptRes = await fetch(`http://localhost:${port}${scriptSrc}`);
      expect(scriptRes.ok).toBe(true);
      
      const contentType = scriptRes.headers.get('content-type');
      expect(contentType).toBeDefined();
      expect(contentType).toMatch(/^(text\/javascript|application\/javascript)(;.*)?$/);
    } finally {
      proc.kill();
    }
  });
});
