import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  projects: [
    {
      name: 'browser',
      use: {
        ...devices['Desktop Chrome'],
        mode: 'browser',
      } as any,
    },
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
