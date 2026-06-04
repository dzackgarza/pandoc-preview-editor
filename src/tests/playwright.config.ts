import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * tauri-playwright custom project option.
 * Augment here so project `use` blocks type-check without `as any`.
 */
declare module '@playwright/test' {
  interface PlaywrightTestOptions {
    mode?: 'browser' | 'tauri' | 'cdp';
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig({
  testDir: './e2e',
  timeout: 300000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  webServer: {
    command: 'npx vite --host localhost --port 5173',
    cwd: repoRoot,
    port: 5173,
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    {
      name: 'browser-smoke',
      testMatch: /app\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        mode: 'browser',
      },
    },
    {
      name: 'tauri',
      testMatch:
        /(desktop-.*|proof-loop|renderer-diagnostics|editor-height|file-integrity|settings|plugins|diagram-workflow|tikz-filter|config-loading|session-persistence|mime-types|architectural-regression|command-parsing|bug-fixes|file-selector|user-behaviors)\.spec\.ts/,
      use: {
        mode: 'tauri',
      },
    },
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
