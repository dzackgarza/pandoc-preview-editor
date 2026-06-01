import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import {
  invokeTauri,
  replaceEditorContents,
  previewInnerHTML,
} from './editor-helpers.js';

const renderTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const documentPath = path.join(testEnv.workspaceDir, 'regression.md');
    writeFileSync(documentPath, '# Regression Test\n\nInitial.\n', 'utf8');
    testEnv.writeSessionState(documentPath, false);

    await use(testEnv);
  },
});

test.describe('Architectural Slop Regression Tests', () => {
  renderTest(
    'render preserves src attributes, comments, and scripts without rewriting them',
    async ({ appPage }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('.cm-content')).toBeVisible({ timeout: 5000 });

      const markdown = [
        '![](figure.png)',
        '',
        '<!-- <img src="comment.png"> -->',
        '',
        '<script>const src="script.png";</script>',
      ].join('\n');

      const result = (await invokeTauri(appPage, 'render', { markdown })) as {
        ok: boolean;
        html: string;
      };

      expect(result.ok).toBe(true);

      const html: string = result.html;

      // The image src attribute remains relative and untouched — pandoc must not mangle it
      expect(html).toContain('src="figure.png"');

      // HTML comments and scripts SHOULD NOT be rewritten by the app
      expect(html).toContain('<!-- <img src="comment.png"> -->');
      expect(html).toContain('<script>const src="script.png";</script>');
    },
  );

  renderTest(
    'render preserves all relative and absolute src paths without mangling',
    async ({ appPage }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const markdown = [
        '<img src="figure.png">',
        '<img src="assets/img/diagram.svg">',
        '<img src="https://example.com/image.png">',
        '<img src="/static/image.png">',
        '<img src="#section">',
        '<img src="data:image/png;base64,iVBORw0KGgo=">',
        '<img src="//cdn.example.com/image.png">',
        '<!-- <img src="comment.png"> -->',
        '<script>const src="script.png";</script>',
        '<span\n  class="math inline"\n  src="multiline.png">x</span>',
        '<figure><img src="photo.jpg" alt="A photo" width="400"/></figure>',
        '<img src="first.png"><img src="second.png">',
        "<img src='local.png'>",
        '<img src="">',
      ].join('\n\n');

      const result = (await invokeTauri(appPage, 'render', { markdown })) as {
        ok: boolean;
        html: string;
      };

      expect(result.ok).toBe(true);

      const html: string = result.html;

      // All paths SHOULD remain completely unmodified and preserved exactly as original
      expect(html).toContain('src="figure.png"');
      expect(html).toContain('src="assets/img/diagram.svg"');
      expect(html).toContain('src="photo.jpg"');
      expect(html).toContain('src="first.png"');
      expect(html).toContain('src="second.png"');
      expect(html).toContain("src='local.png'");
      expect(html).toContain('src="https://example.com/image.png"');
      expect(html).toContain('src="//cdn.example.com/image.png"');
      expect(html).toContain('src="/static/image.png"');
      expect(html).toContain('src="#section"');
      expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
      expect(html).toContain('<!-- <img src="comment.png"> -->');
      expect(html).toContain('<script>const src="script.png";</script>');
      expect(html).toContain('src=""');
    },
  );

  renderTest(
    'rendered preview iframe displays markdown heading and image without distortion',
    async ({ appPage }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('.cm-content')).toBeVisible({ timeout: 5000 });

      const markdown = '# Heading\n\n![alt text](figure.png)\n\nParagraph text here.';

      await replaceEditorContents(appPage, markdown);

      const innerHtml = await previewInnerHTML(appPage);
      expect(innerHtml).toContain('Heading');
      expect(innerHtml).toContain('figure.png');
      expect(innerHtml).toContain('Paragraph text here');
    },
  );
});
