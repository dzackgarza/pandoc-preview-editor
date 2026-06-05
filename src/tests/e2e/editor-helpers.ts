import path from 'node:path';
import type { TauriPage } from '@srsholmes/tauri-playwright';
import { expect } from './fixtures.js';

/** The TauriPage adapter — always TauriPage in E2E desktop mode. */
export type AppPage = TauriPage;

/**
 * Replace all content in the CodeMirror editor.
 * Uses standard DOM interactions.
 */
export async function replaceEditorContents(
  appPage: AppPage,
  text: string,
): Promise<void> {
  const content = appPage.locator('.cm-content');
  await content.click();
  await appPage.keyboard.press('Control+A');
  await appPage.keyboard.press('Backspace');
  await content.fill(text);
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
export async function invokeTauri<T>(
  appPage: AppPage,
  command: string,
  args: object = {},
): Promise<T> {
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

import { load as parseTomlRaw } from 'js-toml';

/** Explicit structure for config.toml content. */
export interface ConfigToml {
  pandoc: {
    render_command: string;
    templates_dir: string;
    filters_dir: string;
    debounce_ms: number;
    timeout_ms: number;
  };
  session: {
    restore_last_file: boolean;
  };
}

export function parseToml(content: string): ConfigToml {
  return parseTomlRaw(content) as unknown as ConfigToml;
}

export interface PandocAssets {
  templates: string[];
  filters: string[];
}

export function getPandocFilters(assets: PandocAssets): string[] {
  return assets.filters;
}
