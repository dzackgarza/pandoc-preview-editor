import { test, expect } from './fixtures.js';

test('app loads without errors and renders static content', async ({
  tauriPage,
}: any) => {
  await tauriPage.goto('/');
  await expect(tauriPage.locator('body')).toContainText('pandoc-preview');
});
