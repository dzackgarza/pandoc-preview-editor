import path from 'node:path';
import { writeFileSync } from 'node:fs';

import { expect, test } from './fixtures.js';

async function replaceEditorContents(appPage: any, text: string) {
  await appPage.evaluate(`
    (() => {
      const view = window.__PANDOC_PREVIEW_EDITOR_VIEW__;
      if (!view) {
        throw new Error('Playwright editor hook is not available');
      }
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: ${JSON.stringify(text)},
        },
      });
    })()
  `);
}

async function previewText(appPage: any) {
  return appPage.locator('#preview').evaluate((element: HTMLIFrameElement) => {
    return element.contentDocument?.body?.textContent ?? '';
  });
}

async function invokeConfig(
  appPage: any,
  method: string,
  args: Record<string, unknown>,
) {
  return appPage.evaluate(
    async ({ cmd, params }: { cmd: string; params: Record<string, unknown> }) => {
      return (window as any).__TAURI_INTERNALS__.invoke(cmd, params);
    },
    { cmd: method, params: args },
  );
}

const failingRendererTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const failingScript = path.join(testEnv.rootDir, 'failing-renderer.mjs');
    writeFileSync(
      failingScript,
      [
        '#!/usr/bin/env node',
        'process.stderr.write("Fatal compilation error:\\nMissing \\\\end{document}\\nat line 14\\n");',
        'process.exit(1);',
      ].join('\n'),
      'utf8',
    );

    testEnv.writeConfig({
      renderCommand: `node ${failingScript}`,
      debounceMs: 100,
      timeoutMs: 30000,
    });

    await use(testEnv);
  },
});

test.describe('Renderer Diagnostics UI E2E', () => {
  failingRendererTest(
    'displays detailed renderer stderr and recovers on successful render',
    async ({ appPage, testEnv }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('.cm-content')).toBeVisible({ timeout: 5000 });

      await replaceEditorContents(appPage, '# Failing Render Test');

      await expect(appPage.locator('#status')).toContainText('error', {
        timeout: 10000,
      });

      const diagnosticsPanel = appPage.getByTestId('diagnostics-panel');
      await expect(diagnosticsPanel).toBeVisible({ timeout: 5000 });
      await expect(diagnosticsPanel.getByTestId('diagnostics-title')).toContainText(
        'Renderer Error',
      );
      await expect(diagnosticsPanel.getByTestId('diagnostics-detail')).toContainText(
        'Fatal compilation error',
      );
      await expect(diagnosticsPanel.getByTestId('diagnostics-detail')).toContainText(
        'Missing \\end{document}',
      );
      await expect(diagnosticsPanel.getByTestId('diagnostics-detail')).toContainText(
        'at line 14',
      );

      const goodCommand =
        'pandoc -f markdown+tex_math_dollars+citations -t html --standalone --citeproc --mathjax --lua-filter=~/.pandoc/filters/tikzcd.lua --lua-filter=~/.pandoc/filters/convert_amsthm_envs.lua --template=~/.pandoc/templates/pandoc_preview_template.html';

      const configResult = await invokeConfig(appPage, 'set_config', {
        templates_dir: testEnv.homeDir + '/.pandoc/templates',
        filters_dir: testEnv.homeDir + '/.pandoc/filters',
        debounce_ms: 100,
        timeout_ms: 30000,
        render_command: goodCommand,
      });
      expect(configResult).toEqual({ ok: true });

      await replaceEditorContents(appPage, '# Recovered successfully\n\nIt works!');

      await expect(diagnosticsPanel).not.toBeVisible({ timeout: 10000 });

      await expect(appPage.locator('#status')).toContainText(/ready|saved/, {
        timeout: 5000,
      });

      const preview = await previewText(appPage);
      expect(preview).toContain('Recovered successfully');
      expect(preview).toContain('It works!');
    },
  );
});
