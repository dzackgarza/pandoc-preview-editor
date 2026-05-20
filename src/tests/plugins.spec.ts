import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killServer, launchServer, type ServerInstance } from './helpers.js';

function createWorkspace(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'pandoc-plugins-'));
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

test.describe('plugin API', () => {
  test('lists bundled plugin metadata without command internals', async () => {
    const { dir, file } = createWorkspace('# Plugin Source\n\nInitial.');
    let server: ServerInstance | undefined;

    try {
      server = await launchServer(undefined, file);
      const res = await fetch(`${server.url}/api/plugins`);
      const data = (await res.json()) as {
        plugins: Array<{
          id: string;
          name: string;
          category: string;
          command?: string;
          args?: string[];
        }>;
      };

      expect(res.status).toBe(200);
      expect(data.plugins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'export-html',
            name: 'Export to HTML',
            category: 'Export',
          }),
        ]),
      );
      const exportHtml = data.plugins.find((plugin) => plugin.id === 'export-html');
      expect(exportHtml).not.toHaveProperty('command');
      expect(exportHtml).not.toHaveProperty('args');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('runs export plugin against the app tracked file', async () => {
    const { dir, file } = createWorkspace('# Exported Title\n\nFrom plugin API.');
    const output = join(dir, 'source.html');
    let server: ServerInstance | undefined;

    try {
      server = await launchServer(undefined, file);
      const res = await fetch(`${server.url}/api/plugins/export-html/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: file,
          markdown: '# Exported Title\n\nFrom plugin API.',
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        exitCode: number;
        outputPath?: string;
      };

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.exitCode).toBe(0);
      expect(data.outputPath).toBe(output);
      expect(existsSync(output)).toBe(true);
      expect(readFileSync(output, 'utf-8')).toContain('Exported Title');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });
});
