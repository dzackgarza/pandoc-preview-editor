import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { killServer, launchServer, type ServerInstance } from './helpers.js';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

function createWorkspace(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'pandoc-responsiveness-'));
  const file = join(dir, 'source.md');
  writeFileSync(file, content, 'utf-8');
  return { dir, file };
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

test.describe('responsiveness', () => {
  test('cancels in-flight renders when a newer one is requested', async () => {
    const { dir, file } = createWorkspace('# Test Document\n\nInitial content.');

    // Create a test config that uses our slow renderer
    const slowRendererPath = join(__dirname, 'slow-renderer.mjs');
    const testConfigPath = join(dir, 'test-config.toml');
    writeFileSync(
      testConfigPath,
      `[pandoc]
render_command = "node ${slowRendererPath}"

[render]
timeout_ms = 5000
`,
      'utf-8',
    );

    let server: ServerInstance | undefined;

    try {
      server = await launchServer(undefined, file, testConfigPath);

      // Send two render requests quickly
      const startTime = Date.now();

      const request1 = fetch(`${server.url}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: '# First Request' }),
      });

      // Wait a tiny bit, then send the second request
      await new Promise((r) => setTimeout(r, 100));

      const request2 = fetch(`${server.url}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: '# Second Request' }),
      });

      // Wait for the second request to complete
      const response2 = await request2;
      const data2 = (await response2.json()) as {
        ok?: boolean;
        html?: string;
      };

      const totalTime = Date.now() - startTime;

      // Verify the second request succeeded
      expect(response2.status).toBe(200);
      expect(data2.ok).toBe(true);
      expect(data2.html).toContain('<h1>Second Request</h1>');

      // Verify it completed faster than the full 2s slow render (since the first one was cancelled)
      expect(totalTime).toBeLessThan(2500); // Should finish much faster than 2 seconds
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });
});
