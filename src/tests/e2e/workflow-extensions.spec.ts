import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import * as import_child_process from 'node:child_process';
import path from 'node:path';
import { expect, test } from './fixtures.js';
import {
  invokeTauri,
  previewText,
  replaceEditorContents,
  previewInnerHTML,
} from './editor-helpers.js';

const extensionsWorkflowTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const docPath = path.join(testEnv.workspaceDir, 'source.md');
    writeFileSync(docPath, '# Extensions Test\n\nInitial content.\n', 'utf8');
    testEnv.writeSessionState(docPath, false);
    await use(testEnv);
  },
});

test.describe('Desktop Extensions Workflow (Consolidated)', () => {
  extensionsWorkflowTest(
    'exercises plugins, diagram creation, image pasting, and filter rendering',
    async ({ appPage, testEnv }) => {
      const docPath = path.join(testEnv.workspaceDir, 'source.md');
      const htmlPath = path.join(testEnv.workspaceDir, 'source.html');
      const pdfPath = path.join(testEnv.workspaceDir, 'source.pdf');

      await expect(appPage.getByTestId('editor')).toBeVisible();

      // 1. Plugin & Tool Discovery (via UI)
      await appPage.getByTestId('menu-trigger-file').click();
      await appPage.getByTestId('menu-item-preferences').click();
      const dialog = appPage.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await dialog.locator('[role="tab"]').filter({ hasText: 'Plugins' }).click();
      await expect(dialog.locator('text=Export to HTML')).toBeVisible();
      await expect(dialog.locator('text=Export to PDF')).toBeVisible();
      await dialog.locator('button').filter({ hasText: 'Cancel' }).click();

      // 2. Diagram Creation Workflow
      await appPage.keyboard.press('Control+Shift+D');
      const modal = appPage.locator('[role="dialog"]');
      await expect(modal).toBeVisible();
      await expect(modal.locator('select[aria-label="Diagram Type"]')).toContainText('qtikz');
      await modal.locator('input[aria-label="Filename"]').fill('my-diagram.tikz');
      await modal.locator('button').filter({ hasText: 'Create' }).click();
      await expect(modal).not.toBeVisible();

      const editorContent = await appPage.evaluate<string>(
        'window.__PANDOC_PREVIEW_EDITOR_VIEW__.state.doc.toString()',
      );
      expect(editorContent).toContain('![](./figures/my-diagram.tikz)');
      expect(existsSync(path.join(testEnv.workspaceDir, 'figures', 'my-diagram.tikz'))).toBe(true);

      // 3. Image Paste Workflow
      try {
        import_child_process.execSync('which wl-copy', { stdio: 'ignore' });
      } catch (e) {
        throw new Error('Missing hard dependency: wl-copy is required for clipboard E2E tests. Failing fast.');
      }

      // Minimal 1x1 red PNG
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
        0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      const tmpPngPath = path.join(testEnv.workspaceDir, 'test-clipboard.png');
      writeFileSync(tmpPngPath, pngBuffer);

      import_child_process.execSync(`wl-copy --type image/png < ${tmpPngPath}`);

      await appPage.getByTestId('editor').click();
      await appPage.keyboard.press('Control+V');

      await expect
        .poll(() =>
          appPage.evaluate<string>(
            'window.__PANDOC_PREVIEW_EDITOR_VIEW__.state.doc.toString()',
          ),
        )
        .toMatch(/!\[\]\(\.\/figures\/figure-.*\.png\)/);

      // 4. Plugin Execution (Export via Menu)
      await appPage.getByTestId('menu-trigger-plugin').click();
      await appPage.getByTestId('menu-subtrigger-export').hover();
      await appPage.getByTestId('menu-item-export-html').click();

      await expect(appPage.locator('#status')).toContainText(/ready|saved/, { timeout: 15000 });
      expect(existsSync(htmlPath)).toBe(true);

      await appPage.getByTestId('menu-trigger-plugin').click();
      await appPage.getByTestId('menu-subtrigger-export').hover();
      await appPage.getByTestId('menu-item-export-pdf').click();

      await expect(appPage.locator('#status')).toContainText(/ready|saved/, { timeout: 15000 });
      expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');

      // 5. Filter Rendering (TikZjax)
      const tikzBlock = '```tikz\n\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}\n```';
      await replaceEditorContents(appPage, tikzBlock);
      await expect.poll(() => previewInnerHTML(appPage), { timeout: 15000 })
        .toContain('<svg');
    }
  );
});
