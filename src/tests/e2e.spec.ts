import { test, expect } from '@playwright/test';
import { launchServer, killServer, type ServerInstance } from './helpers.js';

let server: ServerInstance;

/** Get a locator for the preview iframe's body content. */
function previewFrame(page: import('@playwright/test').Page) {
  return page.frameLocator('#preview');
}

test.describe('preview E2E', () => {
  test.beforeAll(async () => {
    server = await launchServer();
  });

  test.afterAll(async () => {
    if (server) {
      const stdout = server.out.join('').slice(-2000);
      const stderr = server.err.join('').slice(-2000);
      if (stdout) console.log('\n=== SERVER STDOUT ===\n' + stdout);
      if (stderr) console.log('\n=== SERVER STDERR ===\n' + stderr);
      await killServer(server);
    }
  });

  test('page loads with editor and preview elements', async ({ page }) => {
    await page.goto(server.url);
    await expect(page.locator('#editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#preview')).toBeAttached();
  });

  test('initial render from default content', async ({ page }) => {
    await page.goto(server.url);
    // The iframe srcdoc is set asynchronously after the first render completes.
    // Wait for the srcdoc attribute to be present with a non-empty value.
    await expect(page.locator('#preview')).toHaveAttribute('srcdoc', /.+/, {
      timeout: 5000,
    });
  });

  test('typing in textarea updates preview', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');
    const frame = previewFrame(page);

    await editor.fill('# Hello World\n\nThis is a test.');
    // Wait for debounce (400ms) plus render
    await expect(frame.locator('body')).toContainText('Hello World', { timeout: 5000 });
    await expect(frame.locator('body')).toContainText('test');
  });

  test('renders markdown headings', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('## Section Title');
    const frame = previewFrame(page);
    await expect(frame.locator('h2')).toContainText('Section Title', {
      timeout: 5000,
    });
  });

  test('renders bold text', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('This is **very important**.');
    const frame = previewFrame(page);
    await expect(frame.locator('strong')).toContainText('very important', {
      timeout: 5000,
    });
  });

  test('renders math', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('The formula $E=mc^2$ is famous.');
    const frame = previewFrame(page);
    await expect(frame.locator('.math')).toBeAttached({ timeout: 5000 });
  });

  test('renders code blocks', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('```js\nconst x = 1;\n```');
    const frame = previewFrame(page);
    await expect(frame.locator('code')).toContainText('const x = 1', {
      timeout: 5000,
    });
  });

  test('renders lists', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('- alpha\n- beta\n- gamma');
    const frame = previewFrame(page);
    const items = frame.locator('li');
    await expect(items).toHaveCount(3, { timeout: 5000 });
    await expect(items.nth(0)).toContainText('alpha');
    await expect(items.nth(1)).toContainText('beta');
    await expect(items.nth(2)).toContainText('gamma');
  });

  test('status indicator shows ready after render', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('# Status Test');
    await expect(page.locator('#status.ok')).toBeAttached({ timeout: 5000 });
  });

  test('duration displays render time', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('# Duration Test');
    await expect(page.locator('#duration')).toContainText('ms', { timeout: 5000 });
  });

  test('Ctrl+S triggers immediate render', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    // Fill then immediately Ctrl+S (bypasses debounce)
    await editor.fill('## Ctrl+S test');
    await editor.press('Control+s');

    const frame = previewFrame(page);
    await expect(frame.locator('h2')).toContainText('Ctrl+S test', {
      timeout: 3000,
    });
  });

  test('rapid typing triggers one render after debounce', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    // Type characters rapidly (simulates fast typing)
    await editor.fill('');
    for (const ch of 'abcdefghij') {
      await editor.press(ch);
    }

    // After debounce, the final content should render
    const frame = previewFrame(page);
    await expect(frame.locator('body')).toContainText('abcdefghij', { timeout: 5000 });
  });

  test('version tracking discards stale renders', async ({ page }) => {
    // Rapidly submit two different markdowns and verify final content wins
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('# First');
    await page.waitForTimeout(100);

    await editor.fill('# Second');
    const frame = previewFrame(page);
    await expect(frame.locator('h1')).toContainText('Second', { timeout: 5000 });
  });

  test('renders links', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('[Example](https://example.com)');
    const frame = previewFrame(page);
    const link = frame.locator('a');
    await expect(link).toContainText('Example', { timeout: 5000 });
    await expect(link).toHaveAttribute('href', 'https://example.com');
  });

  test('renders blockquotes', async ({ page }) => {
    await page.goto(server.url);
    const editor = page.locator('#editor');

    await editor.fill('> This is a quotation.');
    const frame = previewFrame(page);
    await expect(frame.locator('blockquote')).toContainText('quotation', {
      timeout: 5000,
    });
  });
});
