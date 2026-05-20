import { test, expect } from '@playwright/test';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { setEditorMarkdown } from './editor-helpers.js';

let server: ServerInstance;

test.describe('math rendering', () => {
  test.beforeAll(async () => {
    server = await launchServer();
  });

  test.afterAll(async () => {
    if (server) await killServer(server);
  });

  test('MathJax renders inline math in preview iframe', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, 'The formula $E=mc^2$ is famous.');
    const frame = page.frameLocator('#preview');

    await expect(frame.locator('mjx-container')).toBeAttached({ timeout: 10000 });

    const mjxContainer = frame.locator('mjx-container').first();
    await expect(mjxContainer).toContainText('E');
    await expect(mjxContainer).toContainText('m');
    await expect(mjxContainer).toContainText('c');
    await expect(mjxContainer).toContainText('2');

    await expect(frame.locator('.math.inline')).toBeAttached();
  });

  test('MathJax renders display math in preview iframe', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(
      page,
      'The formula\n\n$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$\n\nis famous.',
    );
    const frame = page.frameLocator('#preview');

    await expect(frame.locator('mjx-container[display="true"]')).toBeAttached({
      timeout: 10000,
    });

    const displayMath = frame.locator('mjx-container[display="true"]').first();
    await expect(displayMath).toContainText('\u03c0');
    await expect(displayMath).toContainText('\u221e');
  });
});
