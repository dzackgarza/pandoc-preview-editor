// @ts-nocheck -- tauri-playwright 0.2.2 fixture/types are intentionally loose

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import { invokeTauri } from './editor-helpers.js';

const savedFileTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const docPath = path.join(testEnv.workspaceDir, 'doc.md');
    writeFileSync(docPath, '# My Document\n\nNo figures yet.\n', 'utf8');
    testEnv.writeSessionState(docPath, false);

    await use(testEnv);
  },
});

const diagramToolsTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const docPath = path.join(testEnv.workspaceDir, 'doc.md');
    writeFileSync(docPath, '# My Document\n\nNo figures yet.\n', 'utf8');

    testEnv.writeConfig({
      renderCommand:
        'pandoc -f markdown -t html --standalone --lua-filter=' +
        path.join(testEnv.homeDir, '.pandoc', 'filters', 'tikzcd.lua'),
    });
    testEnv.writeSessionState(docPath, false);

    await use(testEnv);
  },
});

test.describe('diagram toolbar and filter workflows', () => {
  test('get_diagram_tools returns available tools with installed status', async ({
    appPage,
  }) => {
    const data = await invokeTauri(appPage, 'get_diagram_tools', {});

    expect(data).toBeDefined();
    expect(typeof data).toBe('object');
    // At minimum, some tool IDs must be present (qtikz, tikzit, inkscape, etc.)
    const toolIds = Object.keys(data);
    expect(toolIds.length).toBeGreaterThan(0);
  });

  diagramToolsTest('pandoc_assets returns available filters', async ({ appPage }) => {
    const data = await invokeTauri(appPage, 'pandoc_assets', {});

    expect(data).toBeDefined();
    expect(Array.isArray(data.filters)).toBe(true);
  });

  test('create_diagram_file rejects on unsaved temp buffer', async ({ appPage }) => {
    // When no file path is established, creating a diagram should be blocked (save-gate)
    try {
      await invokeTauri(appPage, 'create_diagram_file', {
        kind: 'qtikz',
        filename: 'diagram1.tikz',
        documentPath: '/tmp/pandoc-preview/untitled-123.md',
      });
      // If it resolves, it must indicate failure
      expect(true).toBe(false);
    } catch (error: any) {
      expect(String(error)).toContain('save the document');
    }
  });

  savedFileTest(
    'create_diagram_file creates template on saved document',
    async ({ appPage, testEnv }) => {
      const docPath = path.join(testEnv.workspaceDir, 'doc.md');
      const rand = Math.random().toString(36).substring(7);
      const figFilename = `diagram-${rand}.tikz`;

      const result = await invokeTauri(appPage, 'create_diagram_file', {
        kind: 'qtikz',
        filename: figFilename,
        documentPath: docPath,
      });

      expect(result.ok).toBe(true);
      expect(result.relativePath).toBe(`figures/${figFilename}`);
      expect(result.absolutePath).toContain(`figures/${figFilename}`);

      const createdPath = result.absolutePath;
      expect(existsSync(createdPath)).toBe(true);
      const content = readFileSync(createdPath, 'utf-8');
      expect(content).toContain('\\begin{tikzpicture}');
    },
  );

  savedFileTest(
    'diagram_proxy delivers web tool content with overlay injection',
    async ({ appPage, testEnv }) => {
      // Proxy a known local-ish URL through the Tauri command.
      // We use a real allowed host (q.uiver.app) — the test verifies
      // the proxy returns HTML with the injected overlay.
      const result = await invokeTauri(appPage, 'diagram_proxy', {
        url: 'https://q.uiver.app',
      });

      expect(result).toBeDefined();
      expect(result.html).toBeDefined();

      // The proxy must inject a <base href> tag for same-origin resolution
      expect(result.html).toContain('<base href="');

      // The proxy must inject the TikZ overlay script/buttons
      expect(result.html).toContain('pandoc-preview-export-overlay');
      expect(result.html).toContain('pandoc-preview-btn-export');
    },
  );
});
