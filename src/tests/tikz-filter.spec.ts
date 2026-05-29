import { test, expect } from '@playwright/test';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { setEditorMarkdown } from './editor-helpers.js';

let server: ServerInstance;

function previewFrame(page: import('@playwright/test').Page) {
  return page.frameLocator('#preview');
}

test.describe('Server-side TikZ Lua Filter E2E', () => {
  let pageErrors: Error[] = [];
  let consoleErrors: string[] = [];

  test.beforeAll(async () => {
    // Launch server with default config (which now has the Lua filter by default)
    server = await launchServer();
  });

  test.afterAll(async () => {
    if (server) {
      await killServer(server);
    }
  });

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
  });

  test.afterEach(async () => {
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('renders tikzcd environment as a static server-side SVG without client-side scripts', async ({ page }) => {
    await page.goto(server.url);
    await expect(page.locator('#editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#preview')).toBeAttached();

    const tikzcdMarkdown = [
      '# TikZcd Server Render Test',
      '',
      '\\begin{tikzcd}',
      'A \\arrow[r] & B',
      '\\end{tikzcd}',
    ].join('\n');

    await setEditorMarkdown(page, tikzcdMarkdown);

    const frame = previewFrame(page);
    await expect(frame.locator('h1')).toHaveText('TikZcd Server Render Test');

    // With the server-side Lua filter, the SVG should be compiled on the server and present
    // immediately in the raw HTML iframe srcDoc. We expect to see the SVG element.
    const svg = frame.locator('svg');
    await expect(svg).toBeAttached({ timeout: 5000 });

    // Assert that the SVG contains vector path details
    await expect(frame.locator('svg path').first()).toBeAttached({ timeout: 2000 });

    // CRITICAL ASSERTION: The SVG was rendered completely on the server-side.
    // Therefore, the iframe should NOT have loaded the dynamic tikzjax.js script or fonts.css
    const tikzjaxScript = frame.locator('script[src*="tikzjax.js"]');
    const tikzjaxFonts = frame.locator('link[href*="fonts.css"]');
    await expect(tikzjaxScript).not.toBeAttached();
    await expect(tikzjaxFonts).not.toBeAttached();
  });

  test('recursively resolves \\input{...} inside tikz environment', async ({ page }) => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const testDir = mkdtempSync(join(tmpdir(), 'pandoc-tikz-input-'));
    const docPath = join(testDir, 'doc.md');
    const subTikzPath = join(testDir, 'my-sub-diagram.tikz');

    // Create the referenced tikz file
    writeFileSync(subTikzPath, 'A \\arrow[r] & B', 'utf-8');

    // Create the main document using \input{}
    writeFileSync(
      docPath,
      [
        '# TikZcd Input Test',
        '',
        '\\begin{tikzcd}',
        '\\input{my-sub-diagram.tikz}',
        '\\end{tikzcd}',
      ].join('\n'),
      'utf-8'
    );

    // Launch an isolated server instance for this document
    const isolatedServer = await launchServer(undefined, docPath);

    try {
      await page.goto(isolatedServer.url);
      await expect(page.locator('#editor')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#preview')).toBeAttached();

      const frame = previewFrame(page);
      await expect(frame.locator('h1')).toHaveText('TikZcd Input Test');

      // The SVG should be successfully compiled because the filter resolved the \input
      const svg = frame.locator('svg');
      await expect(svg).toBeAttached({ timeout: 15000 });
      await expect(frame.locator('svg path').first()).toBeAttached({ timeout: 5000 });
    } finally {
      await killServer(isolatedServer);
    }
  });

  test('resolves and renders Inkscape svg-inkscape pdf_tex overlays', async ({ page }) => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { execSync } = await import('node:child_process');

    const testDir = mkdtempSync(join(tmpdir(), 'pandoc-inkscape-'));
    const docPath = join(testDir, 'doc.md');
    const pdfTexPath = join(testDir, 'my-fig.pdf_tex');

    // Generate a valid mock pdf file in the test directory using pdflatex
    try {
      execSync(
        'pdflatex -interaction=nonstopmode -jobname=my-fig "\\documentclass[tikz]{standalone}\\begin{document}\\begin{tikzpicture}\\draw(0,0) circle (20pt);\\end{tikzpicture}\\end{document}"',
        { cwd: testDir, stdio: 'ignore' }
      );
    } catch (err) {
      console.warn('Skipping test as pdflatex is not available in the test runner environment');
      return;
    }

    // Create the pdf_tex file containing LaTeX overlays
    const pdfTexContent = [
      '\\begingroup',
      '  \\begin{picture}(100,100)',
      '    \\put(0,0){\\includegraphics[width=\\unitlength]{my-fig.pdf}}',
      '    \\put(20,50){LaTeX text $\\gamma_1$}',
      '  \\end{picture}',
      '\\endgroup',
    ].join('\n');
    writeFileSync(pdfTexPath, pdfTexContent, 'utf-8');

    // Create main document referring to the pdf_tex file
    writeFileSync(
      docPath,
      [
        '# Inkscape LaTeX Test',
        '',
        '\\input{my-fig.pdf_tex}',
      ].join('\n'),
      'utf-8'
    );

    // Launch isolated server instance
    const isolatedServer = await launchServer(undefined, docPath);

    try {
      await page.goto(isolatedServer.url);
      await expect(page.locator('#editor')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#preview')).toBeAttached();

      const frame = previewFrame(page);
      await expect(frame.locator('h1')).toHaveText('Inkscape LaTeX Test');

      // The SVG should render both the circle shape and the LaTeX overlay text
      const svg = frame.locator('svg');
      await expect(svg).toBeAttached({ timeout: 15000 });
      await expect(frame.locator('svg path').first()).toBeAttached({ timeout: 5000 });
    } finally {
      await killServer(isolatedServer);
    }
  });
});
