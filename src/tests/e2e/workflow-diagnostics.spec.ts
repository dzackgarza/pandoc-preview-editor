import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures.js';
import {
  invokeTauri,
  replaceEditorContents,
} from './editor-helpers.js';

const diagnosticsWorkflowTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const docPath = path.join(testEnv.workspaceDir, 'diag.md');
    writeFileSync(docPath, '# Diagnostics\n\nInitial.\n', 'utf8');
    testEnv.writeSessionState(docPath, false);
    await use(testEnv);
  },
});

test.describe('Desktop Diagnostics Workflow (Consolidated)', () => {
  diagnosticsWorkflowTest(
    'exercises renderer error capture, diagnostics display, and recovery',
    async ({ appPage }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible();

      // 1. Trigger Renderer Error (via UI)
      await appPage.getByTestId('menu-trigger-file').click();
      await appPage.getByTestId('menu-item-preferences').click();
      const dialog = appPage.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await dialog.locator('[role="tab"]').filter({ hasText: 'Raw Command' }).click();
      
      const argsTextarea = dialog.locator('textarea[aria-label="Render Command"]');
      await argsTextarea.fill('zsh -c "echo renderer exploded >&2; exit 42"');
      await appPage.locator('button').filter({ hasText: 'Apply Settings' }).click();
      await expect(dialog).not.toBeVisible();

      await replaceEditorContents(appPage, '# Broken\n\nForce render.');
      
      // 2. Status Bar Error State
      await expect(appPage.locator('#status')).toHaveAttribute('data-state', 'error', { timeout: 10000 });

      // 3. Diagnostics Overlay Proof
      const diagOverlay = appPage.locator('#diagnostics');
      await expect(diagOverlay).toBeVisible();
      await expect(diagOverlay).toContainText('renderer exploded');
      await expect(diagOverlay).toContainText('exit code: 42');

      // 4. Recovery Workflow (via UI)
      await appPage.getByTestId('menu-trigger-file').click();
      await appPage.getByTestId('menu-item-preferences').click();
      await expect(dialog).toBeVisible();
      await dialog.locator('[role="tab"]').filter({ hasText: 'Raw Command' }).click();
      await argsTextarea.fill('pandoc -f markdown -t html --standalone');
      await appPage.locator('button').filter({ hasText: 'Apply Settings' }).click();
      await expect(dialog).not.toBeVisible();

      // Status should return to ready/saved and overlay should disappear
      await expect(appPage.locator('#status')).not.toHaveAttribute('data-state', 'error');
      await expect(diagOverlay).not.toBeVisible();
      await expect(appPage.locator('#status')).toHaveAttribute('data-state', 'idle');
    }
  );
});
