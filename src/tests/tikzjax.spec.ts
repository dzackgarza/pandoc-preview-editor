import { test, expect } from '@playwright/test';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { setEditorMarkdown } from './editor-helpers.js';

let server: ServerInstance;

function previewFrame(page: import('@playwright/test').Page) {
  return page.frameLocator('#preview');
}

test.describe('TikZJax rendering E2E', () => {
  let pageErrors: Error[] = [];
  let consoleErrors: string[] = [];

  test.beforeAll(async () => {
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

  test('renders ```tikz code block as an SVG in the preview', async ({ page }) => {
    await page.goto(server.url);
    await expect(page.locator('#editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#preview')).toBeAttached();

    const tikzMarkdown = [
      '# TikZ Test',
      '',
      '```tikz',
      '\\begin{tikzpicture}',
      '\\draw (0,0) circle (1in);',
      '\\end{tikzpicture}',
      '```',
    ].join('\n');

    await setEditorMarkdown(page, tikzMarkdown);

    // Wait for the iframe's content to render.
    const frame = previewFrame(page);
    await expect(frame.locator('h1')).toHaveText('TikZ Test');

    // We expect the TikZ block to be converted to an SVG.
    // The timeout is slightly generous (15s) because WebAssembly/TikZ compilation takes a moment.
    const svg = frame.locator('svg');
    await expect(svg).toBeVisible({ timeout: 15000 });
    
    // Check that it's a valid SVG with circle inside
    await expect(frame.locator('svg circle')).toBeVisible({ timeout: 5000 });
  });
});
