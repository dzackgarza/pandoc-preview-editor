import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import { invokeTauri } from './editor-helpers.js';

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

const savedFileTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const documentPath = path.join(testEnv.workspaceDir, 'source.md');
    writeFileSync(documentPath, '# Plugin Source\n\nInitial.\n', 'utf8');
    testEnv.writeSessionState(documentPath, false);

    await use(testEnv);
  },
});

test.describe('plugin API', () => {
  savedFileTest(
    'lists bundled plugin metadata without command internals',
    async ({ appPage }) => {
      const data = (await invokeTauri(appPage, 'list_plugins', {})) as {
        plugins: Array<{
          id: string;
          name: string;
          category: string;
          command?: unknown;
          args?: unknown;
        }>;
      };

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

      const exportHtml = data.plugins.find((p) => p.id === 'export-html');
      expect(exportHtml).not.toHaveProperty('command');
      expect(exportHtml).not.toHaveProperty('args');
    },
  );

  test('plugin rejects run without a saved file path', async ({ appPage }) => {
    try {
      await invokeTauri(appPage, 'run_plugin', {
        id: 'export-html',
        markdown: '# Temp Backed Buffer\n\nNo user path has been chosen.',
      });
      // If it resolves instead of rejecting, ok must be false
      expect(true).toBe(false);
    } catch (error: any) {
      expect(String(error)).toContain('save the document first');
    }
  });

  savedFileTest(
    'runs HTML export against the app tracked file',
    async ({ appPage, testEnv }) => {
      const documentPath = path.join(testEnv.workspaceDir, 'source.md');
      const outputPath = path.join(testEnv.workspaceDir, 'source.html');

      const result = (await invokeTauri(appPage, 'run_plugin', {
        id: 'export-html',
        path: documentPath,
        markdown: '# Plugin Source\n\nInitial.',
      })) as { ok: boolean; exitCode: number; outputPath: string };

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.outputPath).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);

      const expected = path.join(testEnv.workspaceDir, 'expected.html');
      pandocOracle(documentPath, expected, 'html');
      expect(readFileSync(outputPath, 'utf-8')).toBe(readFileSync(expected, 'utf-8'));
    },
  );

  savedFileTest(
    'runs LaTeX export against the app tracked file',
    async ({ appPage, testEnv }) => {
      const documentPath = path.join(testEnv.workspaceDir, 'source.md');
      writeFileSync(documentPath, '# LaTeX Title\n\nInline math $x^2$.', 'utf8');

      const result = (await invokeTauri(appPage, 'run_plugin', {
        id: 'export-latex',
        path: documentPath,
        markdown: '# LaTeX Title\n\nInline math $x^2$.',
      })) as { ok: boolean; exitCode: number; outputPath: string };

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);

      const outputTex = path.join(testEnv.workspaceDir, 'source.tex');
      expect(result.outputPath).toBe(outputTex);

      const expected = path.join(testEnv.workspaceDir, 'expected.tex');
      pandocOracle(documentPath, expected, 'latex');
      expect(readFileSync(outputTex, 'utf-8')).toBe(readFileSync(expected, 'utf-8'));
    },
  );

  test('plugin run with explicit path succeeds even from unsaved state', async ({
    appPage,
    testEnv,
  }) => {
    const documentPath = path.join(testEnv.workspaceDir, 'temp-export.md');
    writeFileSync(
      documentPath,
      '# Temp Server Export\n\nServer started without a file.\n',
      'utf8',
    );

    const result = (await invokeTauri(appPage, 'run_plugin', {
      id: 'export-html',
      path: documentPath,
      markdown: '# Temp Server Export\n\nServer started without a file.\n',
    })) as { ok: boolean; exitCode: number; outputPath: string };

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);

    const outputPath = path.join(testEnv.workspaceDir, 'temp-export.html');
    expect(existsSync(outputPath)).toBe(true);
  });

  savedFileTest(
    'runs PDF export against the app tracked file',
    async ({ appPage, testEnv }) => {
      const documentPath = path.join(testEnv.workspaceDir, 'source.md');
      writeFileSync(documentPath, '# PDF Title\n\nGenerated by pandoc.', 'utf8');

      const result = (await invokeTauri(appPage, 'run_plugin', {
        id: 'export-pdf',
        path: documentPath,
        markdown: '# PDF Title\n\nGenerated by pandoc.',
      })) as { ok: boolean; exitCode: number; outputPath: string };

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);

      const outputPdf = path.join(testEnv.workspaceDir, 'source.pdf');
      expect(result.outputPath).toBe(outputPdf);
      expect(readFileSync(outputPdf).subarray(0, 5).toString('utf-8')).toBe('%PDF-');
    },
  );
});
