import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

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

test.describe('Session Persistence and Ephemeral Buffer Recovery', () => {
  let tempHome: string;
  let tempCwd: string;
  const cliPath = resolve(process.cwd(), 'src/server/cli.ts');

  test.beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'pandoc-home-'));
    tempCwd = mkdtempSync(join(tmpdir(), 'pandoc-test-cwd-'));
  });

  test.afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(tempCwd, { recursive: true, force: true });
  });

  test('should backup unsaved edits and restore last active file on reload/restart', async () => {
    const port1 = await findFreePort();
    
    // Spawn server with custom HOME to isolate XDG paths
    const proc1 = spawn('npx', ['tsx', cliPath, '--port', String(port1)], {
      cwd: tempCwd,
      env: {
        ...process.env,
        HOME: tempHome,
        XDG_STATE_HOME: join(tempHome, '.local', 'state'),
      },
    });
    proc1.stderr?.pipe(process.stderr);
    proc1.stdout?.pipe(process.stdout);

    const out1: string[] = [];
    proc1.stdout?.on('data', (d) => out1.push(d.toString()));

    await new Promise<void>((resolveWait) => {
      proc1.stdout?.on('data', (d) => {
        if (d.toString().includes('pandoc-preview running at')) {
          resolveWait();
        }
      });
    });

    // Make a request to the backup endpoint to simulate editing and backing up
    const originalFile = join(tempCwd, 'my-document.md');
    writeFileSync(originalFile, '# My Document\n', 'utf-8');

    const backupRes = await fetch(`http://localhost:${port1}/api/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown: '# My Document\n\nUnsaved edit!',
        path: originalFile,
      }),
    });

    expect(backupRes.ok).toBe(true);
    proc1.kill();

    // Verify backup was created persistently in state directory
    const hash = createHash('sha256').update(resolve(originalFile)).digest('hex');
    const expectedBackupPath = join(tempHome, '.local', 'state', 'pandoc-preview', 'backups', `${hash}.md`);
    expect(existsSync(expectedBackupPath)).toBe(true);
    expect(readFileSync(expectedBackupPath, 'utf-8')).toContain('Unsaved edit!');

    // Start server again and verify it recovers the unsaved session automatically!
    const port2 = await findFreePort();
    const proc2 = spawn('npx', ['tsx', cliPath, '--port', String(port2)], {
      cwd: tempCwd,
      env: {
        ...process.env,
        HOME: tempHome,
        XDG_STATE_HOME: join(tempHome, '.local', 'state'),
      },
    });
    proc2.stderr?.pipe(process.stderr);
    proc2.stdout?.pipe(process.stdout);

    const out2: string[] = [];
    proc2.stdout?.on('data', (d) => out2.push(d.toString()));

    await new Promise<void>((resolveWait) => {
      proc2.stdout?.on('data', (d) => {
        if (d.toString().includes('pandoc-preview running at')) {
          resolveWait();
        }
      });
    });

    try {
      const indexRes = await fetch(`http://localhost:${port2}/`);
      expect(indexRes.ok).toBe(true);
      const html = await indexRes.text();

      // Verify that the restored content contains the unsaved edits
      expect(html).toContain('Unsaved edit!');
      expect(html).toContain('__RECOVERED_FROM_BACKUP = true');
    } finally {
      proc2.kill();
    }
  });

  test('should restore unsaved editor buffer upon browser page reload', async ({ page }) => {
    const port = await findFreePort();
    const proc = spawn('npx', ['tsx', cliPath, '--port', String(port)], {
      cwd: tempCwd,
      env: {
        ...process.env,
        HOME: tempHome,
        XDG_STATE_HOME: join(tempHome, '.local', 'state'),
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
      // 1. Go to the page
      await page.goto(`http://localhost:${port}`);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 10000 });

      // 2. Enter unsaved edits in the editor
      const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
      await page.locator('#editor .cm-content').click();
      await page.keyboard.press(selectAll);
      await page.keyboard.insertText('# Unsaved buffer content!');

      // Wait for backup debounce write
      await page.waitForTimeout(1000);

      // 3. Reload the page
      await page.reload();
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 10000 });

      // 4. Assert that the unsaved changes are successfully recovered and loaded in the editor
      const editorText = await page.locator('#editor .cm-content').innerText();
      expect(editorText).toContain('# Unsaved buffer content!');
      
      // Verify that the toast alert is displayed
      await expect(page.getByText('Unsaved Changes Recovered')).toBeVisible({ timeout: 5000 });
    } finally {
      proc.kill();
    }
  });
});
