// @ts-nocheck — tauri-playwright 0.2.2 types reference unexported PageLike

import { createTauriTest } from '@srsholmes/tauri-playwright';

export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:5173',
  tauriCommand: 'src/tests/e2e/run-tauri-dev.sh',
  tauriCwd: process.cwd(),
  startTimeout: 120,
});
