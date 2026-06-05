import { expect, test } from './fixtures.js';

test('minimal connection probe', async ({ tauriPage }) => {
  // If we get here, the tauriPage fixture successfully:
  // 1. Launched the app
  // 2. Connected to the socket
  // 3. Verified window 'main'
  console.log('Successfully attached to window "main"');
  await expect(tauriPage).toHaveTitle(/Pandoc Preview/);
});
