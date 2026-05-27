import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { setEditorMarkdown } from './editor-helpers.js';

let server: ServerInstance;

test.describe('Renderer Diagnostics UI E2E', () => {
  let pageErrors: Error[] = [];
  let consoleErrors: string[] = [];

  test.beforeAll(async () => {
    // Reset the failing configuration dynamically to ensure idempotency across consecutive runs
    const configPath = '/tmp/pandoc-preview-test-fail.toml';
    const tomlContent = [
      '[render]',
      'debounce_ms = 100',
      'timeout_ms = 30000',
      '',
      '[pandoc]',
      'render_command = "node src/tests/failing-renderer.mjs"',
      'templates_dir = "~/.pandoc/templates"',
      'filters_dir = "~/.pandoc/filters"',
    ].join('\n');
    writeFileSync(configPath, tomlContent, 'utf-8');

    // Launch server with the deterministic failing renderer config
    server = await launchServer(undefined, undefined, configPath);
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

  test('displays detailed renderer stderr and recovers on successful render', async ({ page }) => {
    await page.goto(server.url);
    await expect(page.locator('#editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

    // 1. Enter some markdown text to trigger a render failure
    await setEditorMarkdown(page, '# Failing Render Test');

    // 2. Expect status footer cluster to reflect 'error' state
    await expect(page.locator('#status')).toContainText('error', { timeout: 10000 });

    // 3. Expect the diagnostics panel to be visible in the app chrome with the exact stderr output
    const diagnosticsPanel = page.locator('[data-testid="diagnostics-panel"]');
    await expect(diagnosticsPanel).toBeVisible({ timeout: 5000 });
    await expect(diagnosticsPanel.locator('[data-testid="diagnostics-title"]')).toContainText('Renderer Error');
    await expect(diagnosticsPanel.locator('[data-testid="diagnostics-detail"]')).toContainText('Fatal compilation error:\nMissing \\end{document}\nat line 14');

    // 4. Update configuration dynamically via the api to simulate a working renderer (recovery)
    const originalCommand = "pandoc -f markdown+tex_math_dollars+citations -t html --standalone --citeproc --mathjax --lua-filter=~/.pandoc/filters/tikzcd.lua --lua-filter=~/.pandoc/filters/convert_amsthm_envs.lua --template=~/.pandoc/templates/pandoc_HTML.template";
    const configRes = await page.evaluate(async (cmd) => {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templatesDir: '~/.pandoc/templates',
          filtersDir: '~/.pandoc/filters',
          debounceMs: 100,
          timeoutMs: 30000,
          renderCommand: cmd,
        }),
      });
      return res.ok;
    }, originalCommand);
    expect(configRes).toBe(true);

    // 5. Retrigger a successful render
    await setEditorMarkdown(page, '# Recovered successfully\n\nIt works!');

    // 6. Assert diagnostics panel automatically disappears
    await expect(diagnosticsPanel).not.toBeVisible({ timeout: 10000 });

    // 7. Assert status becomes ready/saved
    await expect(page.locator('#status')).toContainText(/ready|saved/, { timeout: 5000 });
  });
});
