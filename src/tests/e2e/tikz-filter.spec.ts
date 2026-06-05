import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import {
  replaceEditorContents,
  previewText,
  previewInnerHTML,
} from './editor-helpers.js';

const tikzTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const documentPath = path.join(testEnv.workspaceDir, 'tikz-test.md');
    writeFileSync(documentPath, '# TikZ Test\n\nInitial.\n', 'utf8');
    testEnv.writeSessionState(documentPath, false);

    await use(testEnv);
  },
});

test.describe('Server-side TikZ Lua Filter E2E', () => {
  tikzTest(
    'renders tikzcd environment as a static server-side SVG without client-side scripts',
    async ({ appPage }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('.cm-content')).toBeVisible({ timeout: 5000 });

      const tikzcdMarkdown = [
        '# TikZcd Server Render Test',
        '',
        '\\begin{tikzcd}',
        'A \\arrow[r] & B',
        '\\end{tikzcd}',
      ].join('\n');

      await replaceEditorContents(appPage, tikzcdMarkdown);

      await expect
        .poll(() => previewText(appPage), { timeout: 10000 })
        .toContain('TikZcd Server Render Test');

      // The SVG should be compiled on the server via the Lua filter and present in the preview
      const innerHtml = await previewInnerHTML(appPage);
      expect(innerHtml).toContain('<svg');

      // Assert vector path details inside the SVG
      const hasPath =
        innerHtml.includes('<path') ||
        innerHtml.includes('<line') ||
        innerHtml.includes('<rect');
      expect(hasPath).toBe(true);

      // CRITICAL: No client-side tikzjax.js script or fonts.css should be present
      expect(innerHtml).not.toContain('tikzjax');
      expect(innerHtml).not.toContain('fonts.css');
    },
  );

  tikzTest(
    'recursively resolves \\input{...} inside tikz environment',
    async ({ appPage, testEnv }) => {
      const subTikzPath = path.join(testEnv.workspaceDir, 'my-sub-diagram.tikz');

      writeFileSync(subTikzPath, 'A \\arrow[r] & B', 'utf-8');

      const docContent = [
        '# TikZcd Input Test',
        '',
        '\\begin{tikzcd}',
        '\\input{my-sub-diagram.tikz}',
        '\\end{tikzcd}',
      ].join('\n');

      await replaceEditorContents(appPage, docContent);

      await expect
        .poll(() => previewText(appPage), { timeout: 10000 })
        .toContain('TikZcd Input Test');

      const innerHtml = await previewInnerHTML(appPage);
      expect(innerHtml).toContain('<svg');
    },
  );

  tikzTest(
    'resolves and renders Inkscape svg-inkscape pdf_tex overlays',
    async ({ appPage, testEnv }) => {
      const { execSync } = await import('node:child_process');

      execSync('pdflatex --version', { stdio: 'ignore' });

      const pdfTexPath = path.join(testEnv.workspaceDir, 'my-fig.pdf_tex');

      execSync(
        'pdflatex -interaction=nonstopmode -jobname=my-fig "\\documentclass[tikz]{standalone}\\begin{document}\\begin{tikzpicture}\\draw(0,0) circle (20pt);\\end{tikzpicture}\\end{document}"',
        { cwd: testEnv.workspaceDir, stdio: 'ignore' },
      );

      const pdfTexContent = [
        '\\begingroup',
        '  \\begin{picture}(100,100)',
        '    \\put(0,0){\\includegraphics[width=\\unitlength]{my-fig.pdf}}',
        '    \\put(20,50){LaTeX text $\\gamma_1$}',
        '  \\end{picture}',
        '\\endgroup',
      ].join('\n');
      writeFileSync(pdfTexPath, pdfTexContent, 'utf-8');

      const docContent = ['# Inkscape LaTeX Test', '', '\\input{my-fig.pdf_tex}'].join(
        '\n',
      );

      await replaceEditorContents(appPage, docContent);

      await expect
        .poll(() => previewText(appPage), { timeout: 15000 })
        .toContain('Inkscape LaTeX Test');

      const innerHtml = await previewInnerHTML(appPage);
      expect(innerHtml).toContain('<svg');
    },
  );
});
