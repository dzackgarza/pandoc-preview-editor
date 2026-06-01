import type { TauriPage } from '@srsholmes/tauri-playwright';
import { expect } from './fixtures.js';

/** The TauriPage adapter — always TauriPage in E2E desktop mode. */
export type AppPage = TauriPage;

/**
 * Replace all content in the CodeMirror editor.
 * Uses TauriPage.evaluate(string).
 */
export async function replaceEditorContents(
  appPage: AppPage,
  text: string,
): Promise<void> {
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
 * Uses appPage.evaluate(string) to stay within the typed API.
 */
export async function previewText(appPage: AppPage): Promise<string> {
  return appPage.evaluate(
    `(() => { const iframe = document.querySelector('#preview'); if (!iframe || !iframe.contentDocument) return ''; return iframe.contentDocument.body.textContent ?? ''; })()`,
  );
}

/**
 * Read the rendered innerHTML from the preview iframe.
 * Uses appPage.evaluate(string) to stay within the typed API.
 */
export async function previewInnerHTML(appPage: AppPage): Promise<string> {
  return appPage.evaluate(
    `(() => { const iframe = document.querySelector('#preview'); if (!iframe || !iframe.contentDocument) return ''; return iframe.contentDocument.body.innerHTML ?? ''; })()`,
  );
}

/**
 * Call a Tauri IPC command via the window.__TAURI_INTERNALS__.invoke bridge.
 */
export async function invokeTauri(
  appPage: AppPage,
  command: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return appPage.evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
  );
}

/**
 * Reload the page via TauriPage (supported API).
 */
export async function reloadPage(appPage: AppPage): Promise<void> {
  await appPage.evaluate('window.location.reload()');
}
