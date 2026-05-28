import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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

function pandocOracle(file: string, output: string, target: 'html' | 'latex') {
  const args =
    target === 'html'
      ? [
          file,
          '-f',
          'markdown+tex_math_dollars+citations',
          '-t',
          'html',
          '--standalone',
          '--mathjax',
          '-o',
          output,
        ]
      : [
          file,
          '-f',
          'markdown+tex_math_dollars+citations',
          '-t',
          'latex',
          '-o',
          output,
        ];

  execFileSync('pandoc', args, { stdio: 'pipe' });
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
            id: 'export-latex',
            name: 'Export to LaTeX',
            category: 'Export',
          }),
          expect.objectContaining({
            id: 'export-html',
            name: 'Export to HTML',
            category: 'Export',
          }),
          expect.objectContaining({
            id: 'export-pdf',
            name: 'Export to PDF',
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

  test('plugin refuses to treat a temp backup as document identity', async () => {
    let server: ServerInstance | undefined;

    try {
      server = await launchServer();

      const res = await fetch(`${server.url}/api/plugins/export-html/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: '# Temp Backed Buffer\n\nNo user path has been chosen.',
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };

      expect(res.status).toBe(400);
      expect(data).toEqual({
        ok: false,
        error: 'no file path: save the document first',
      });
    } finally {
      if (server) await killServer(server);
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
        exitCode: number;
        outputPath?: string;
      };

      expect(res.status).toBe(200);
      expect(data.exitCode).toBe(0);
      expect(data.outputPath).toBe(output);
      expect(existsSync(output)).toBe(true);
      const expected = join(dir, 'expected.html');
      pandocOracle(file, expected, 'html');
      expect(readFileSync(output, 'utf-8')).toBe(readFileSync(expected, 'utf-8'));
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('runs LaTeX export against the app tracked file', async () => {
    const { dir, file } = createWorkspace('# LaTeX Title\n\nInline math $x^2$.');
    const output = join(dir, 'source.tex');
    let server: ServerInstance | undefined;

    try {
      server = await launchServer(undefined, file);
      const res = await fetch(`${server.url}/api/plugins/export-latex/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: file,
          markdown: '# LaTeX Title\n\nInline math $x^2$.',
        }),
      });
      const data = (await res.json()) as {
        exitCode: number;
        outputPath?: string;
      };

      expect(res.status).toBe(200);
      expect(data.exitCode).toBe(0);
      expect(data.outputPath).toBe(output);
      const expected = join(dir, 'expected.tex');
      pandocOracle(file, expected, 'latex');
      expect(readFileSync(output, 'utf-8')).toBe(readFileSync(expected, 'utf-8'));
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('plugin run with explicit path succeeds even when server started in temp mode', async () => {
    const { dir, file } = createWorkspace(
      '# Temp Server Export\n\nServer started without a file.',
    );
    const output = join(dir, 'source.html');
    let server: ServerInstance | undefined;

    try {
      // Launch server WITHOUT a file argument — config.isTempFile will be true.
      server = await launchServer();

      const res = await fetch(`${server.url}/api/plugins/export-html/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: file,
          markdown: '# Temp Server Export\n\nServer started without a file.',
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        exitCode?: number;
        outputPath?: string;
      };

      // The server must NOT reject a valid explicit path just because it
      // started in temp mode.  The client always sends a real file path
      // after ensureRealFile resolves it.
      expect(data.ok).toBe(true);
      expect(data.exitCode).toBe(0);
      expect(existsSync(output)).toBe(true);
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('runs PDF export against the app tracked file', async () => {
    const { dir, file } = createWorkspace('# PDF Title\n\nGenerated by pandoc.');
    const output = join(dir, 'source.pdf');
    let server: ServerInstance | undefined;

    try {
      server = await launchServer(undefined, file);
      const res = await fetch(`${server.url}/api/plugins/export-pdf/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: file,
          markdown: '# PDF Title\n\nGenerated by pandoc.',
        }),
      });
      const data = (await res.json()) as {
        exitCode: number;
        outputPath?: string;
      };

      expect(res.status).toBe(200);
      expect(data.exitCode).toBe(0);
      expect(data.outputPath).toBe(output);
      expect(readFileSync(output).subarray(0, 5).toString('utf-8')).toBe('%PDF-');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });
});
