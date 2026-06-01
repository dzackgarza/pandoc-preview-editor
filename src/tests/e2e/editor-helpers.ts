// @ts-nocheck — tauri-playwright 0.2.2 types reference unexported PageLike

import { expect } from './fixtures.js';

/**
 * Replace all content in the CodeMirror editor.
 * Uses TauriPage.evaluate(string) — NOT Playwright's evaluate(fn, arg).
 */
export async function replaceEditorContents(appPage, text) {
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

/**
 * Read the rendered text content from the preview iframe.
 * Uses TauriLocator.evaluate(fn) — this one IS supported.
 */
export async function previewText(appPage) {
  return appPage.locator('#preview').evaluate((element) => {
    return element.contentDocument?.body?.textContent ?? '';
  });
}

/**
 * Read the rendered innerHTML from the preview iframe.
 */
export async function previewInnerHTML(appPage) {
  return appPage.locator('#preview').evaluate((element) => {
    return element.contentDocument?.body?.innerHTML ?? '';
  });
}

/**
 * Call a Tauri IPC command via the window.__TAURI_INTERNALS__.invoke bridge.
 * Uses TauriPage.evaluate(string) — args are serialized into the script.
 */
export async function invokeTauri(appPage, command, args = {}) {
  const result = await appPage.evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
  );
  return result;
}

/**
 * Reload the page via TauriPage (supported API).
 */
export async function reloadPage(appPage) {
  await appPage.evaluate('window.location.reload()');
}
