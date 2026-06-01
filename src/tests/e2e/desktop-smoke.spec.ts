import { expect, test } from './fixtures.js';

test('mounts the live Tauri editor shell without mocked IPC', async ({ appPage }) => {
  await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
  await expect(appPage.getByTestId('preview-pane')).toBeVisible({ timeout: 15000 });
  await expect(appPage.locator('#status')).toContainText('ready', { timeout: 15000 });
});
