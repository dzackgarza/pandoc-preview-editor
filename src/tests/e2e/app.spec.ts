import { expect, test } from '@playwright/test';

const workspaceRoot = process.cwd();
let consoleErrors: string[] = [];
let pageErrors: string[] = [];

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name !== 'browser-smoke') {
    throw new Error('app.spec.ts must run only in the browser-smoke project');
  }

  consoleErrors = [];
  pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack ?? error.message);
  });

  await page.addInitScript(
    ({ cwd }) => {
      (window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
          convertFileSrc: (path: string) => string;
          transformCallback: (callback: unknown) => string;
          metadata: {
            currentWindow: { label: string };
            currentWebview: { label: string };
          };
        };
      }).__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          switch (cmd) {
            case 'get_initial_state':
              return {
                content: '',
                file: null,
                tempBackupFile: null,
                workspaceRoot: cwd,
                isTempFile: false,
                recoveredFromBackup: false,
              };
            case 'render':
              return {
                ok: true,
                html: `<p>${String(args?.markdown ?? '')}</p>`,
                durationMs: 0,
                stderr: '',
              };
            case 'list_files':
              return { entries: [] };
            case 'figures_registry':
              return { figures: [] };
            default:
              throw new Error(`browser-smoke mock missing Tauri command: ${cmd}`);
          }
        },
        convertFileSrc: (path) => path,
        transformCallback: (callback) => {
          const id = Math.random().toString(36).slice(2);
          (
            window as typeof window & Record<string, unknown>
          )[`_${id}`] = callback;
          return id;
        },
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main' },
        },
      };
    },
    { cwd: workspaceRoot },
  );

  await page.goto('/index.html', { waitUntil: 'networkidle' });
});

test.afterEach(async () => {
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('renders the editor shell through the selected app boundary', async ({ page }) => {
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('preview-pane')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#status')).toContainText('ready', { timeout: 15000 });
});
