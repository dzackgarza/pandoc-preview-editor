/**
 * Proof loop E2E: type markdown → see pandoc HTML in the preview iframe.
 *
 * This is the core boundary test. It runs against the live Tauri IPC backend,
 * not mocked. The test proves that user text entered in the editor arrives in
 * the preview as real pandoc-rendered HTML.
 *
 * There is also a browser-smoke project that runs with mocked IPC to verify
 * the UI shell renders. That test lives in the browser-smoke project below.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures.js';
import { replaceEditorContents, previewText } from './editor-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = path.join(__dirname, 'oracles');
const tortureMarkdown = readFileSync(path.join(ORACLE_DIR, 'torture.md'), 'utf-8');

/**
 * tauri project: proof loop with real IPC — type → render → verify.
 */
const proofTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    // Default workspace, no special file setup needed for proof loop.
    await use(testEnv);
  },
});

proofTest.describe('proof loop: markdown → pandoc HTML', () => {
  proofTest(
    'renders torture document with all content classes',
    async ({ appPage }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('#status')).toContainText('ready', {
        timeout: 15000,
      });

      await replaceEditorContents(appPage, tortureMarkdown);

      // Wait for pandoc to render — the h1 heading is the first semantic marker.
      await expect
        .poll(() => previewText(appPage), { timeout: 20000 })
        .toContain('Torture Document');

      // Verify document structure: theorems, proofs, definitions, examples, warnings
      await expect.poll(() => previewText(appPage)).toContain('Theorem');
      await expect.poll(() => previewText(appPage)).toContain('Proof');
      await expect.poll(() => previewText(appPage)).toContain('Definition');
      await expect.poll(() => previewText(appPage)).toContain('Example');
      await expect.poll(() => previewText(appPage)).toContain('Warning');

      // Verify structural elements: tables, tasks, code, links
      await expect.poll(() => previewText(appPage)).toContain('rank');
      await expect.poll(() => previewText(appPage)).toContain('checked task');
      await expect.poll(() => previewText(appPage)).toContain('square');
      // The link text is "Example", URL "https://example.com" — textContent won't include the URL
      await expect.poll(() => previewText(appPage)).toContain('Example');

      // Verify refresh preserves content
      const refreshBtn = appPage
        .locator('button[aria-label="Refresh Preview"]')
        .first();
      if (await refreshBtn.isVisible()) {
        await refreshBtn.click();
        await expect
          .poll(() => previewText(appPage), { timeout: 10000 })
          .toContain('Torture Document');
      }
    },
  );

  proofTest('renders inline math via mathjax', async ({ appPage }) => {
    await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
    await expect(appPage.locator('#status')).toContainText('ready', {
      timeout: 15000,
    });

    await replaceEditorContents(
      appPage,
      'Inline math $E=mc^2$ and display $$a^2 + b^2 = c^2$$',
    );

    await expect.poll(() => previewText(appPage), { timeout: 10000 }).toContain('mc');
  });
});
