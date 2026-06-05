import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
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
      const pngBytes = await appPage.evaluate<number[]>(`
        (async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1; canvas.height = 1;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ff0000';
          ctx.fillRect(0, 0, 1, 1);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          if (!blob) throw new Error('Blob creation failed');
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        })()
      `);

      await appPage.evaluate(`
        (() => {
          const blob = new Blob([new Uint8Array(${JSON.stringify(pngBytes)})], { type: 'image/png' });
          const file = new File([blob], 'pasted.png', { type: 'image/png' });
          const dt = new DataTransfer();
          dt.items.add(file);
          document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
        })()
      `);

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
