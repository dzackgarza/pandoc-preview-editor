import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  webServer: {
    command: 'npx vite',
    port: 5173,
    reuseExistingServer: true,
    timeout: 30000,
  },
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
