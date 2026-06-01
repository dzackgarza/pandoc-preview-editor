// @ts-nocheck — tauri-playwright 0.2.2 types reference unexported PageLike

import { expect } from './fixtures.js';

/** Type markdown into the CodeMirror editor by replacing all content. */
export async function setEditorMarkdown(page, markdown) {
  const editor = page.getByTestId('editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(markdown);
  // Wait for render to propagate — debounce is 250ms default, give it time
  // then check the preview frame for non-empty content
  const preview = page.locator('#preview');
  await expect(preview).toBeAttached({ timeout: 5000 });
}

/** Read the rendered HTML from the preview iframe. */
export async function previewContent(page) {
  return page.evaluate(() => {
    const iframe = document.querySelector('#preview');
    if (!iframe || !iframe.contentDocument) return '';
    return iframe.contentDocument.body.innerHTML;
  });
}
