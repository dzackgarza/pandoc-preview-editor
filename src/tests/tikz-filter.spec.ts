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
    // Launch server with default config (which initially does not have the Lua filter)
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
    await expect(svg).toBeVisible({ timeout: 5000 });

    // Assert that the SVG contains vector path details
    await expect(frame.locator('svg path').first()).toBeVisible({ timeout: 2000 });

    // CRITICAL ASSERTION: The SVG was rendered completely on the server-side.
    // Therefore, the iframe should NOT have loaded the dynamic tikzjax.js script or fonts.css
    const tikzjaxScript = frame.locator('script[src*="tikzjax.js"]');
    const tikzjaxFonts = frame.locator('link[href*="fonts.css"]');
    await expect(tikzjaxScript).not.toBeAttached();
    await expect(tikzjaxFonts).not.toBeAttached();
  });
});
