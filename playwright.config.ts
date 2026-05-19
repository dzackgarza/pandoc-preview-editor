import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 1, // Serial execution - tests share singleton server
  fullyParallel: false,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'NO_OPEN=1 npx tsx server/cli.ts tests/fixtures/test-doc.md',
    port: 3141,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
