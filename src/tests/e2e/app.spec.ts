import { test, expect } from './fixtures.js';

test('renders the editor shell through the selected app boundary', async ({
  tauriPage,
}: any) => {
  await tauriPage.goto('/');
  await expect(tauriPage.getByTestId('editor')).toBeVisible();
  await expect(tauriPage.getByTestId('preview-pane')).toBeVisible();
  await expect(tauriPage.locator('#status')).toContainText('ready');
});
