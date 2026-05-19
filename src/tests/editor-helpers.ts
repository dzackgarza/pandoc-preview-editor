import { expect, type Page } from '@playwright/test';

type PreviewState = {
  markdown: string;
  currentFile: string | null;
};

export async function setEditorMarkdown(page: Page, markdown: string) {
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press(selectAllShortcut());
  await page.keyboard.insertText(markdown);
  await expectEditorMarkdown(page, markdown);
}

export async function expectEditorMarkdown(page: Page, markdown: string) {
  await expect
    .poll(() => editorState(page).then((state) => state.markdown), {
      timeout: 5000,
      intervals: [100, 200, 500],
    })
    .toBe(markdown);
}

export async function editorState(page: Page): Promise<PreviewState> {
  return page.evaluate(() => {
    const state = window.__PANDOC_PREVIEW_STATE__;
    if (!state) throw new Error('Pandoc preview state hook is not ready');
    return state;
  });
}

export async function pressSave(page: Page) {
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press(saveShortcut());
}

function selectAllShortcut() {
  return process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
}

function saveShortcut() {
  return process.platform === 'darwin' ? 'Meta+S' : 'Control+S';
}
