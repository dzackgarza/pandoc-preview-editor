import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /esc-leak.*\.spec\.ts/,
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    browserName: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 800 },
    trace: 'on',
    screenshot: 'on',
  },
});
