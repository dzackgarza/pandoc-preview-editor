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
      const diagramPath = path.join(testEnv.figuresDir, 'my-diagram.tikz');

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

      await expect(appPage.locator('.cm-content')).toContainText(`\\input{${diagramPath}}`);
      expect(existsSync(diagramPath)).toBe(true);

      // 3. Image Paste Workflow
      try {
        import_child_process.execSync('which wl-copy', { stdio: 'ignore' });
      } catch (e) {
        throw new Error('Missing hard dependency: wl-copy is required for clipboard E2E tests. Failing fast.');
      }

      const fixturePngPath = path.join(import_child_process.execSync('pwd').toString().trim(), 'src', 'tests', 'e2e', 'fixtures', 'test-image.png');
      import_child_process.execSync(`wl-copy --type image/png < ${fixturePngPath}`);

      await appPage.getByTestId('editor').click();
      await appPage.keyboard.press('Control+V');

      await expect(appPage.locator('.cm-content')).toContainText(`![](${testEnv.figuresDir}/figure-`);

      // 4. Plugin Execution (Export via Menu)
      await appPage.getByTestId('menu-trigger-plugin').click();
      await appPage.getByTestId('menu-subtrigger-export').hover();
      await appPage.getByTestId('menu-item-export-html').click();

      await expect(appPage.locator('#status')).toHaveAttribute('data-state', 'idle', { timeout: 15000 });
      expect(existsSync(htmlPath)).toBe(true);

      await appPage.getByTestId('menu-trigger-plugin').click();
      await appPage.getByTestId('menu-subtrigger-export').hover();
      await appPage.getByTestId('menu-item-export-pdf').click();

      await expect(appPage.locator('#status')).toHaveAttribute('data-state', 'idle', { timeout: 15000 });
      expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');

      // 5. Server-side TikZ rendering through the configured Pandoc pipeline
      const tikzBlock = '```tikz\n\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}\n```';
      await replaceEditorContents(appPage, tikzBlock);
      await expect.poll(() => previewInnerHTML(appPage), { timeout: 15000 })
        .toContain('<svg');
    }
  );
});
