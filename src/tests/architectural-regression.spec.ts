import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killServer, launchServer, type ServerInstance } from './helpers.js';

function createWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'pandoc-regression-'));
  const file = join(dir, 'source.md');
  writeFileSync(file, '# Test Source\n\nInitial.', 'utf-8');
  return { dir, file };
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

test.describe('Architectural Slop Regression Tests', () => {
  test('withPreviewAssetUrls correctly leaves comments and scripts untouched', async () => {
    const { dir, file } = createWorkspace();
    let server: ServerInstance | undefined;

    try {
      server = await launchServer(undefined, file);

      // Post markdown containing:
      // 1. A normal image (should be rewritten)
      // 2. An HTML comment containing a mock src attribute (should NOT be rewritten)
      // 3. A <script> block with a src variable string (should NOT be rewritten)
      const markdown = [
        '![](figure.png)',
        '',
        '<!-- <img src="comment.png"> -->',
        '',
        '<script>const src="script.png";</script>',
      ].join('\n');

      const res = await fetch(`${server.url}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; html: string };
      expect(data.ok).toBe(true);

      // Normal image SHOULD be rewritten
      expect(data.html).toContain('src="/api/preview-assets?path=figure.png"');

      // HTML comments and scripts SHOULD NOT be rewritten
      expect(data.html).toContain('<!-- <img src="comment.png"> -->');
      expect(data.html).toContain('<script>const src="script.png";</script>');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('quick-open API correctly finds markdown files and operates successfully', async () => {
    const { dir, file } = createWorkspace();
    const nestedFile = join(dir, 'chapter.md');
    writeFileSync(nestedFile, '# Chapter', 'utf-8');

    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, file);

      const res = await fetch(`${server.url}/api/files/quick-open?q=chapter`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        entries: Array<{ path: string; name: string }>;
      };

      expect(data.entries.length).toBeGreaterThanOrEqual(1);
      expect(data.entries[0].name).toBe('chapter.md');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });
});
