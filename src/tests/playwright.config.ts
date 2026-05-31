import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  projects: [
    {
      name: 'browser-smoke',
      use: {
        ...devices['Desktop Chrome'],
        mode: 'browser',
      } as any,
    },
    {
      name: 'tauri',
      use: {
        mode: 'tauri',
      } as any,
    },
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
