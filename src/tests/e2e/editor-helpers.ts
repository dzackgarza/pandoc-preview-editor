import path from 'node:path';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import { expect } from './fixtures.js';

import { load as parseTomlRaw } from 'js-toml';

/**
 * Parse TOML content into a typed record.
 * js-toml's load() returns `unknown` — this wrapper narrows to Record<string, unknown>
 * for property access. All call sites use exact assertions on the result.
 */
export function parseToml(content: string): Record<string, any> {
  return parseTomlRaw(content) as Record<string, unknown>;
}

/**
 * Extract filters from a pandoc_assets IPC result.
 * Tauri IPC returns untyped JSON — this narrows to the known shape.
 */
export function getPandocFilters(assets: unknown): string[] {
  const a = assets as Record<string, unknown>;
  const filters = a.filters;
  if (!Array.isArray(filters)) {
    throw new Error('pandoc_assets: expected filters array');
  }
  return filters as string[];
}

/** The TauriPage adapter — always TauriPage in E2E desktop mode. */
export type AppPage = TauriPage;

/**
 * Replace all content in the CodeMirror editor.
 * Uses TauriPage.evaluate(string).  Polls up to 10s for the editor hook.
 */
export async function replaceEditorContents(
  appPage: AppPage,
  text: string,
): Promise<void> {
  // eslint-disable-next-line sonarjs/no-nested-functions
  await expect
    .poll(
      async () => {
        return appPage.evaluate(`
          (() => {
            const view = window.__PANDOC_PREVIEW_EDITOR_VIEW__;
            if (!view) return 'NO_HOOK';
            view.dispatch({
              changes: {
                from: 0,
                to: view.state.doc.length,
                insert: ${JSON.stringify(text)},
              },
            });
            return 'OK';
          })()
        `);
      },
      { timeout: 10000, intervals: [200, 500] },
    )
    .toBe('OK');
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

/**
 * Fill the file-selector dialog path and click Save.
 * `savePath` must be an absolute filesystem path.
 * Used across multiple specs; kept here to prevent local `any`-typed copies.
 */
export async function saveViaFileSelector(
  appPage: AppPage,
  savePath: string,
): Promise<void> {
  if (!path.isAbsolute(savePath)) {
    throw new Error(`saveViaFileSelector: savePath must be absolute, got ${savePath}`);
  }
  await expect(appPage.getByTestId('file-selector-dialog')).toBeVisible();
  await appPage.getByTestId('file-selector-input').fill(savePath);
  await appPage.getByTestId('file-selector-save').click();
}
