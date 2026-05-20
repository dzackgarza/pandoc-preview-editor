import { test, expect } from '@playwright/test';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { pressSave, setEditorMarkdown } from './editor-helpers.js';

let server: ServerInstance;

/** Get a locator for the preview iframe's body content. */
function previewFrame(page: import('@playwright/test').Page) {
  return page.frameLocator('#preview');
}

test.describe('preview E2E', () => {
  let pageErrors: Error[] = [];
  let consoleErrors: string[] = [];

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
    expect(
      pageErrors,
      `page errors: ${pageErrors.map((e) => e.message).join('; ')}`,
    ).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
  });

  test('page loads with CodeMirror editor and preview iframe', async ({ page }) => {
    await page.goto(server.url);
    await expect(page.locator('#editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
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

  test('typing Markdown updates preview', async ({ page }) => {
    await page.goto(server.url);
    const frame = previewFrame(page);

    await setEditorMarkdown(page, '# Hello World\n\nThis is a test.');
    await expect(frame.locator('body')).toContainText('Hello World', { timeout: 5000 });
    await expect(frame.locator('body')).toContainText('test');
  });

  test('renders markdown headings', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, '## Section Title');
    const frame = previewFrame(page);
    await expect(frame.locator('h2')).toContainText('Section Title', {
      timeout: 5000,
    });
  });

  test('renders bold text', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, 'This is **very important**.');
    const frame = previewFrame(page);
    await expect(frame.locator('strong')).toContainText('very important', {
      timeout: 5000,
    });
  });

  test('renders math', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, 'The formula $E=mc^2$ is famous.');
    const frame = previewFrame(page);
    // Verify MathJax actually rendered (mjx-container), not just static pandoc span
    await expect(frame.locator('mjx-container')).toBeAttached({ timeout: 10000 });
    await expect(frame.locator('mjx-container').first()).toContainText('E');
  });

  test('renders code blocks', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, '```js\nconst x = 1;\n```');
    const frame = previewFrame(page);
    await expect(frame.locator('code')).toContainText('const x = 1', {
      timeout: 5000,
    });
  });

  test('renders lists', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, '- alpha\n- beta\n- gamma');
    const frame = previewFrame(page);
    const items = frame.locator('li');
    await expect(items).toHaveCount(3, { timeout: 5000 });
    await expect(items.nth(0)).toContainText('alpha');
    await expect(items.nth(1)).toContainText('beta');
    await expect(items.nth(2)).toContainText('gamma');
  });

  test('status indicator shows ready after render', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, '# Status Test');
    await expect(page.locator('#status')).toContainText('ready', { timeout: 5000 });
  });

  test('duration displays render time', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, '# Duration Test');
    await expect(page.locator('#duration')).toContainText('ms', { timeout: 5000 });
  });

  test('Ctrl+S triggers immediate render', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, '## Ctrl+S test');
    await pressSave(page);

    const frame = previewFrame(page);
    await expect(frame.locator('h2')).toContainText('Ctrl+S test', {
      timeout: 3000,
    });
  });

  test('rapid typing triggers one render after debounce', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, '');
    await page.locator('#editor .cm-content').click();
    for (const ch of 'abcdefghij') {
      await page.keyboard.press(ch);
    }

    const frame = previewFrame(page);
    await expect(frame.locator('body')).toContainText('abcdefghij', { timeout: 5000 });
  });

  test('version tracking discards stale renders', async ({ page }) => {
    // Rapidly submit two different markdowns and verify final content wins
    await page.goto(server.url);

    await setEditorMarkdown(page, '# First');
    await page.waitForTimeout(100);

    await setEditorMarkdown(page, '# Second');
    const frame = previewFrame(page);
    await expect(frame.locator('h1')).toContainText('Second', { timeout: 5000 });
  });

  test('renders links', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, '[Example](https://example.com)');
    const frame = previewFrame(page);
    const link = frame.locator('a');
    await expect(link).toContainText('Example', { timeout: 5000 });
    await expect(link).toHaveAttribute('href', 'https://example.com');
  });

  test('renders blockquotes', async ({ page }) => {
    await page.goto(server.url);

    await setEditorMarkdown(page, '> This is a quotation.');
    const frame = previewFrame(page);
    await expect(frame.locator('blockquote')).toContainText('quotation', {
      timeout: 5000,
    });
  });

  test('plugin execution shows toast with result', async ({ page }) => {
    await page.goto(server.url);
    await setEditorMarkdown(page, '# Plugin Toast Test\n\nContent from plugin E2E.');

    // Navigate Radix submenu: Plugin > Export > Export to HTML
    await page.getByRole('menuitem', { name: 'Plugin' }).click();
    await page.getByRole('menuitem', { name: 'Export' }).hover();
    await page.getByRole('menuitem', { name: 'Export to HTML' }).click();

    // A toast should appear after plugin completes
    await expect(page.locator('[data-testid="toast"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="toast"]')).toContainText('Export to HTML');
  });
});
