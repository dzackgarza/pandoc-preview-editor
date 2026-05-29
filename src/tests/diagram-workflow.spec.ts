import { test, expect } from '@playwright/test';
import { writeFileSync, existsSync, readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchServer, killServer, type ServerInstance } from './helpers.js';
import { setEditorMarkdown } from './editor-helpers.js';

let server: ServerInstance;
const TEST_CONFIG_PATH = '/tmp/pandoc-preview-test-diagram.toml';

test.describe('Diagram Toolbar & Filter Modal E2E', () => {
  let pageErrors: Error[] = [];
  let consoleErrors: string[] = [];

  test.beforeAll(async () => {
    // Write a clean temporary configuration file to ensure test isolation
    const tomlContent = [
      '[render]',
      'debounce_ms = 100',
      'timeout_ms = 30000',
      '',
      '[pandoc]',
      'render_command = "pandoc -f markdown -t html --standalone --lua-filter=~/.pandoc/filters/tikzcd.lua"',
      'templates_dir = "~/.pandoc/templates"',
      'filters_dir = "~/.pandoc/filters"',
    ].join('\n');
    writeFileSync(TEST_CONFIG_PATH, tomlContent, 'utf-8');

    // Launch server using this config
    server = await launchServer(undefined, undefined, TEST_CONFIG_PATH);
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
    await page.goto(server.url);
  });

  test.afterEach(async () => {
    expect(pageErrors).toEqual([]);
    const filteredConsole = consoleErrors.filter((err) => !err.includes('409'));
    expect(filteredConsole).toEqual([]);
  });

  test('GET /api/filters returns available filters with correct status', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const response = await fetch('/api/filters');
      return response.json();
    });

    expect(res).toBeDefined();
    expect(res.filters).toBeInstanceOf(Array);
    
    // Expect tikzcd.lua to exist in ~/.pandoc/filters and be enabled by our render_command
    const tikzFilter = res.filters.find((f: any) => f.name === 'tikzcd.lua');
    expect(tikzFilter).toBeDefined();
    expect(tikzFilter.enabled).toBe(true);
  });

  test('POST /api/filters toggles filters and persists to TOML', async ({ page }) => {
    // 1. Disable tikzcd.lua
    const resDisable = await page.evaluate(async () => {
      const response = await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: [] }),
      });
      return response.json();
    });
    expect(resDisable.ok).toBe(true);

    // 2. Check updated filters state
    const resAfter = await page.evaluate(async () => {
      const response = await fetch('/api/filters');
      return response.json();
    });
    const tikzFilterAfter = resAfter.filters.find((f: any) => f.name === 'tikzcd.lua');
    expect(tikzFilterAfter.enabled).toBe(false);

    // 3. Verify TOML file updated on disk
    const tomlData = readFileSync(TEST_CONFIG_PATH, 'utf-8');
    expect(tomlData).not.toContain('--lua-filter=~/.pandoc/filters/tikzcd.lua');
  });

  test('POST /api/diagram/file rejects on unsaved temp buffer', async ({ page }) => {
    // When the document is a temp file, launching should be blocked (save-gate)
    const res = await page.evaluate(async () => {
      const response = await fetch('/api/diagram/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'qtikz',
          filename: 'diagram1.tikz',
          documentPath: '/tmp/pandoc-preview/untitled-123.md',
        }),
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('save the document');
  });

  test('POST /api/diagram/file creates template on saved document', async ({ page }) => {
    // Save a real file to establish a document path
    const docPath = '/tmp/pandoc-preview-test-doc.md';
    const resSave = await page.evaluate(async (path) => {
      const response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: '# My Document',
          path,
        }),
      });
      return response.json();
    }, docPath);
    expect(resSave.ok).toBe(true);

    // Write qtikz file relative to this document
    const rand = Math.random().toString(36).substring(7);
    const figFilename = `diagram-${rand}.tikz`;
    const resFile = await page.evaluate(async ({ path, filename }) => {
      const response = await fetch('/api/diagram/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'qtikz',
          filename,
          documentPath: path,
        }),
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    }, { path: docPath, filename: figFilename });

    if (!resFile.ok) {
      console.error('DIAGNOSTIC: resFile failed:', resFile.body);
    }
    expect(resFile.ok).toBe(true);
    expect(resFile.body.relativePath).toBe(`figures/${figFilename}`);
    expect(resFile.body.absolutePath).toContain(`figures/${figFilename}`);

    // Verify file exists on disk and contains starter template
    const createdPath = resolve('/tmp', 'figures', figFilename);
    expect(existsSync(createdPath)).toBe(true);
    const content = readFileSync(createdPath, 'utf-8');
    expect(content).toContain('\\begin{tikzpicture}');
  });

  test('GET /api/diagram/proxy delivers web tool content with same-origin overlay script', async ({ page }) => {
    // Use an inline data URL or a mock remote server, or we can proxy a small public page / local resource.
    // For TDD, let's proxy the server's own config page or a mock to verify injection.
    const targetUrl = `${server.url}/api/config`;
    const res = await page.evaluate(async (url) => {
      const response = await fetch(`/api/diagram/proxy?url=${encodeURIComponent(url)}`);
      return response.text();
    }, targetUrl);

    expect(res).toContain('<base href="');
    expect(res).toContain('pandoc-preview-export-overlay');
    expect(res).toContain('pandoc-preview-btn-export');
  });

  test('Managed Figures Central Registry, Figures Library sidebar, and preview Hover-to-Edit overlay', async ({
    page,
  }) => {
    const testDir = mkdtempSync(join(tmpdir(), 'pandoc-managed-figures-'));
    const docPath = join(testDir, 'doc.md');
    const tomlPath = join(testDir, 'pandoc-preview.toml');
    const centralFiguresDir = join(testDir, 'central-figures');
    mkdirSync(centralFiguresDir, { recursive: true });

    writeFileSync(
      docPath,
      '# My Document\n\nHere is an inlined diagram:\n\n![](' + centralFiguresDir + '/my-tikz-diag.tikz)\n',
      'utf-8'
    );

    const initialToml = `
[render]
debounce_ms = 100
timeout_ms = 30000

[pandoc]
render_command = "pandoc -f markdown -t html"
templates_dir = "${testDir}/templates"
filters_dir = "${testDir}/filters"

[figures]
storage_strategy = "central"
central_directory = "${centralFiguresDir}"
`;
    writeFileSync(tomlPath, initialToml, 'utf-8');

    const serverInstance = await launchServer(undefined, docPath, tomlPath);

    try {
      await page.goto(serverInstance.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });

      // 1. Create a figure via the central registry endpoint /api/diagram/file
      // Since strategy is central, it should save to centralFiguresDir and register it
      const resFile = await page.evaluate(async ({ path }) => {
        const response = await fetch('/api/diagram/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'qtikz',
            filename: 'my-tikz-diag.tikz',
            documentPath: path,
          }),
        });
        return { ok: response.ok, body: await response.json() };
      }, { path: docPath });

      expect(resFile.ok).toBe(true);
      expect(resFile.body.absolutePath).toBe(join(centralFiguresDir, 'my-tikz-diag.tikz'));

      // 2. Fetch the central registry via /api/figures/registry and check entries
      const registryData = await page.evaluate(async () => {
        const response = await fetch('/api/figures/registry');
        return response.json();
      });
      expect(registryData.figures).toBeDefined();
      expect(registryData.figures.length).toBe(1);
      expect(registryData.figures[0].name).toBe('my-tikz-diag.tikz');

      // 3. Check the client sidebar UI has "Figures Library" tab and displays our registered figure
      const figuresTabTrigger = page.locator('[aria-label="Figures Library"]');
      await expect(figuresTabTrigger).toBeVisible();
      await figuresTabTrigger.click();

      // Should show the figures list with our registered figure name
      await expect(page.getByText('my-tikz-diag.tikz', { exact: true })).toBeVisible();

      // 4. Check the hover-to-edit overlay button inside the preview pane iframe
      const previewIframe = page.locator('#preview');
      await expect(previewIframe).toBeVisible();

      // Let's trigger a mouseenter on the image to activate the hover overlay button
      const iframeBody = previewIframe.contentFrame().locator('body');
      await expect(iframeBody).toBeVisible();

      // Wait a bit for render to complete
      await page.waitForTimeout(1000);

      // Verify the image exists inside the preview
      const imgLocator = previewIframe.contentFrame().locator('img, embed, .tikz');
      const overlayBtn = previewIframe.contentFrame().locator('.pandoc-preview-hover-edit');
      
      // Since it's a TDD red test, this entire flow will fail initially
      if (await imgLocator.count() > 0) {
        await imgLocator.first().hover();
        await expect(overlayBtn.first()).toBeVisible({ timeout: 3000 });
        await expect(overlayBtn.first()).toHaveText(/Edit/);
      } else {
        // Assert that the image locator is actually present
        expect(await imgLocator.count()).toBeGreaterThan(0);
      }
    } finally {
      await killServer(serverInstance);
    }
  });
});
