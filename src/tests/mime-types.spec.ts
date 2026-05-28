import { expect, test } from '@playwright/test';
import { existsSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { killServer, launchServer } from './helpers.js';
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

test.describe('Strict MIME Type Safety (Simulated Unreliable Environment)', () => {
  const distClientDir = resolve(process.cwd(), 'dist', 'client');
  const testMjsPath = join(distClientDir, 'test-module.mjs');
  const testWasmPath = join(distClientDir, 'test-wasm.wasm');

  test.beforeEach(() => {
    mkdirSync(distClientDir, { recursive: true });
    writeFileSync(testMjsPath, 'export const val = 42;', 'utf-8');
    writeFileSync(testWasmPath, new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])); // WASM magic header
  });

  test.afterEach(() => {
    if (existsSync(testMjsPath)) rmSync(testMjsPath);
    if (existsSync(testWasmPath)) rmSync(testWasmPath);
  });

  test('should fail module script MIME checks under simulated host MIME database failure', async () => {
    const port = await findFreePort();
    const cliPath = resolve(process.cwd(), 'src/server/cli.ts');
    
    // Spawn server with MOCK_MIME_FAIL enabled to simulate host OS mime-db absence
    const proc = spawn('npx', ['tsx', cliPath, '--port', String(port)], {
      env: {
        ...process.env,
        MOCK_MIME_FAIL: 'true',
      },
    });

    const out: string[] = [];
    proc.stdout?.on('data', (d) => out.push(d.toString()));

    await new Promise<void>((resolveWait) => {
      proc.stdout?.on('data', (d) => {
        if (d.toString().includes('pandoc-preview running at')) {
          resolveWait();
        }
      });
    });

    try {
      const response = await fetch(`http://localhost:${port}/test-module.mjs`);
      expect(response.ok).toBe(true);

      const contentType = response.headers.get('content-type');
      expect(contentType).toBeDefined();
      
      // This assertion MUST fail under mock failure because contentType will be application/octet-stream
      expect(contentType).toMatch(/^(text\/javascript|application\/javascript)(;.*)?$/);
    } finally {
      proc.kill();
    }
  });

  test('should fail WASM MIME checks under simulated host MIME database failure', async () => {
    const port = await findFreePort();
    const cliPath = resolve(process.cwd(), 'src/server/cli.ts');
    
    const proc = spawn('npx', ['tsx', cliPath, '--port', String(port)], {
      env: {
        ...process.env,
        MOCK_MIME_FAIL: 'true',
      },
    });

    await new Promise<void>((resolveWait) => {
      proc.stdout?.on('data', (d) => {
        if (d.toString().includes('pandoc-preview running at')) {
          resolveWait();
        }
      });
    });

    try {
      const response = await fetch(`http://localhost:${port}/test-wasm.wasm`);
      expect(response.ok).toBe(true);

      const contentType = response.headers.get('content-type');
      expect(contentType).toBeDefined();
      
      // This assertion MUST fail under mock failure because contentType will be application/octet-stream
      expect(contentType).toMatch(/^application\/wasm(;.*)?$/);
    } finally {
      proc.kill();
    }
  });
});
