import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /certification\.spec\.ts/,
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    trace: 'on',
    screenshot: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
});
