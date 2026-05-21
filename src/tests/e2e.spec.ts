import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { setEditorMarkdown } from './editor-helpers.js';

let server: ServerInstance;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = resolve(__dirname, 'oracles');
const tortureMarkdown = readOracle('torture.md');
const tortureExpectedBody = readOracle('torture.expected-body.html').trim();

/** Get a locator for the preview iframe's body content. */
function previewFrame(page: import('@playwright/test').Page) {
  return page.frameLocator('#preview');
}

function readOracle(name: string) {
  return readFileSync(resolve(ORACLE_DIR, name), 'utf-8');
}

function extractBody(html: string) {
  const match = html.match(/<body>\n?([\s\S]*)\n?<\/body>/);
  if (!match) throw new Error('Expected standalone HTML with a body element');
  return match[1].trim();
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

  test('editing a complex document produces the exact configured renderer body', async ({
    page,
  }) => {
    await page.goto(server.url);
    await expect(page.locator('#editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#preview')).toBeAttached();

    await setEditorMarkdown(page, tortureMarkdown);

    await expect
      .poll(
        async () => {
          const srcdoc = await page.locator('#preview').getAttribute('srcdoc');
          return srcdoc ? extractBody(srcdoc) : '';
        },
        { timeout: 5000, intervals: [100, 200, 500] },
      )
      .toBe(tortureExpectedBody);

    const frame = previewFrame(page);
    await expect(frame.locator('h1#torture-document')).toHaveText(
      'Torture Document',
    );
    await expect(frame.locator('div.theorem')).toHaveText(
      'Theorem. Every nonzero finite-dimensional vector space has a basis.',
    );
    await expect(frame.locator('div.proof')).toHaveText(
      'Proof. Choose a maximal independent set.',
    );
    await expect(frame.locator('div.definition')).toHaveText(
      'Definition. A lattice is a free module with a bilinear form.',
    );
    await expect(frame.locator('div.example')).toContainText(
      'Example. Z2 with dot product.',
    );
    await expect(frame.locator('div.warning')).toHaveText(
      'Warning. This is not a cryptographic lattice assumption.',
    );
    await expect(frame.locator('table tbody tr')).toHaveCount(2);
    await expect(frame.locator('ul.task-list input[checked]')).toHaveCount(1);
    await expect(frame.locator('a[title="Example title"]')).toHaveAttribute(
      'href',
      'https://example.com',
    );
    await expect(frame.locator('mjx-container').first()).toBeAttached({
      timeout: 10000,
    });

    const refreshBtn = page.getByRole('button', { name: /refresh/i });
    await expect(refreshBtn).toBeVisible({ timeout: 2000 });
    await refreshBtn.click();

    await expect
      .poll(
        async () => {
          const srcdoc = await page.locator('#preview').getAttribute('srcdoc');
          return srcdoc ? extractBody(srcdoc) : '';
        },
        { timeout: 5000, intervals: [100, 200, 500] },
      )
      .toBe(tortureExpectedBody);
  });
});
