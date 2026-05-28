import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

// Helper to find a free port
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

test.describe('Centralized TOML Configuration', () => {
  let tempCwd: string;
  let tempXdgHome: string;
  const cliPath = resolve(process.cwd(), 'src/server/cli.ts');

  test.beforeEach(() => {
    tempCwd = mkdtempSync(join(tmpdir(), 'pandoc-cwd-'));
    tempXdgHome = mkdtempSync(join(tmpdir(), 'pandoc-xdg-'));
  });

  test.afterEach(() => {
    rmSync(tempCwd, { recursive: true, force: true });
    rmSync(tempXdgHome, { recursive: true, force: true });
  });

  test('should initialize default config.toml in XDG directory if no config exists', async () => {
    const port = await findFreePort();
    const xdgConfigHome = tempXdgHome;
    
    // Spawn the CLI in tempCwd (no local pandoc-preview.toml)
    // pass XDG_CONFIG_HOME env var
    const proc = spawn('npx', ['tsx', cliPath, '--port', String(port)], {
      cwd: tempCwd,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    });

    const out: string[] = [];
    const err: string[] = [];

    proc.stdout?.on('data', (d) => out.push(d.toString()));
    proc.stderr?.on('data', (d) => err.push(d.toString()));

    // Wait for the initialization log or server startup log
    await new Promise<void>((resolveWait, reject) => {
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error(`Timeout waiting for CLI output. stdout: ${out.join('')}, stderr: ${err.join('')}`));
      }, 15000);

      const checkOutput = (data: string) => {
        if (
          data.includes('pandoc-preview running at') ||
          data.includes('Server running at') ||
          data.includes('Initialized default configuration')
        ) {
          clearTimeout(timeout);
          resolveWait();
        }
      };

      proc.stdout?.on('data', (d) => checkOutput(d.toString()));
      proc.stderr?.on('data', (d) => checkOutput(d.toString()));
      proc.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(`CLI exited with code ${code}. stderr: ${err.join('')}`));
        }
      });
    });

    proc.kill();

    // Verify the file was created at $XDG_CONFIG_HOME/pandoc-preview/config.toml
    const expectedPath = join(xdgConfigHome, 'pandoc-preview', 'config.toml');
    expect(existsSync(expectedPath)).toBe(true);

    const contents = readFileSync(expectedPath, 'utf-8');
    expect(contents).toContain('[pandoc]');
    expect(contents).toContain('render_command');
  });

  test('should load existing config.toml from XDG directory', async () => {
    const port = await findFreePort();
    const xdgConfigHome = tempXdgHome;
    const xdgBaseDir = join(xdgConfigHome, 'pandoc-preview');
    mkdirSync(xdgBaseDir, { recursive: true });
    
    const configPath = join(xdgBaseDir, 'config.toml');
    const customConfig = `[render]
debounce_ms = 999
timeout_ms = 40000

[pandoc]
render_command = "pandoc --version"
`;
    writeFileSync(configPath, customConfig, 'utf-8');

    const proc = spawn('npx', ['tsx', cliPath, '--port', String(port)], {
      cwd: tempCwd,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    });

    const out: string[] = [];
    const err: string[] = [];
    proc.stdout?.on('data', (d) => out.push(d.toString()));
    proc.stderr?.on('data', (d) => err.push(d.toString()));

    await new Promise<void>((resolveWait, reject) => {
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error('Timeout waiting for server startup'));
      }, 15000);

      proc.stdout?.on('data', (d) => {
        const str = d.toString();
        if (str.includes('pandoc-preview running at') || str.includes('Server running at')) {
          clearTimeout(timeout);
          resolveWait();
        }
      });
      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(`CLI exited with code ${code}`));
        }
      });
    });

    proc.kill();

    // Verify it did not overwrite the custom config
    const contents = readFileSync(configPath, 'utf-8');
    expect(contents).toContain('debounce_ms = 999');
  });
});
