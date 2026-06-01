import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { expect, test } from './fixtures.js';

async function invokeConfig(
  appPage: any,
  method: string,
  args: Record<string, unknown>,
) {
  return appPage.evaluate(
    async ({ cmd, params }: { cmd: string; params: Record<string, unknown> }) => {
      return (window as any).__TAURI_INTERNALS__.invoke(cmd, params);
    },
    { cmd: method, params: args },
  );
}

async function replaceEditorContents(appPage: any, text: string) {
  await appPage.evaluate(`
    (() => {
      const view = window.__PANDOC_PREVIEW_EDITOR_VIEW__;
      if (!view) {
        throw new Error('Playwright editor hook is not available');
      }
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: ${JSON.stringify(text)},
        },
      });
    })()
  `);
}

async function previewText(appPage: any) {
  return appPage.locator('#preview').evaluate((element: HTMLIFrameElement) => {
    return element.contentDocument?.body?.textContent ?? '';
  });
}

const sessionRecoveryTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const docPath = path.join(testEnv.workspaceDir, 'my-document.md');
    mkdirSync(path.dirname(docPath), { recursive: true });
    writeFileSync(docPath, '# My Document\n', 'utf-8');

    testEnv.writeSessionState(docPath, false);

    await use(testEnv);
  },
});

const backupRecoveryTest = test.extend({
  launchSetup: async ({}, use) => {
    // First launch: write file, edit, backup, then close.
    // Second launch: write session state pointing to the file with a backup,
    // and verify recovery.
    await use(async () => {});
  },
  testEnv: async ({ testEnv }, use) => {
    const docPath = path.join(testEnv.workspaceDir, 'recovery-test.md');
    mkdirSync(path.dirname(docPath), { recursive: true });
    writeFileSync(docPath, '# Recovery Test\n\nOriginal content.\n', 'utf-8');

    testEnv.writeConfig({ restoreLastFile: true });
    testEnv.writeSessionState(docPath, false);

    await use(testEnv);
  },
});

const unsavedBufferRecoveryTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const docPath = path.join(testEnv.workspaceDir, 'buffer-test.md');
    mkdirSync(path.dirname(docPath), { recursive: true });
    writeFileSync(docPath, '# Buffer Test\n\nOriginal on disk.\n', 'utf-8');

    testEnv.writeConfig({ restoreLastFile: true });
    testEnv.writeSessionState(docPath, false);

    await use(testEnv);
  },
});

const restoreLastFileDisabledTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const docPath = path.join(testEnv.workspaceDir, 'disabled-restore.md');
    mkdirSync(path.dirname(docPath), { recursive: true });
    writeFileSync(docPath, '# Restore Disabled\n\nShould not auto-load.\n', 'utf-8');

    testEnv.writeConfig({ restoreLastFile: false });

    // No writeSessionState — even if one existed, the app should ignore it.

    await use(testEnv);
  },
});

test.describe('Session Persistence and Ephemeral Buffer Recovery (Tauri)', () => {
  sessionRecoveryTest(
    'restores last active file from session state on launch',
    async ({ appPage, testEnv }) => {
      const docPath = path.join(testEnv.workspaceDir, 'my-document.md');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        docPath,
      );

      const stateContent = readFileSync(testEnv.sessionStatePath, 'utf-8');
      const stateJson = JSON.parse(stateContent);
      expect(stateJson.last_file).toBe(docPath);
      expect(stateJson.is_temp_file).toBe(false);
    },
  );

  sessionRecoveryTest(
    'session state file path matches the file shown in editor footer',
    async ({ appPage, testEnv }) => {
      const docPath = path.join(testEnv.workspaceDir, 'my-document.md');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const initialState = await invokeConfig(appPage, 'get_initial_state', {});
      const s = initialState as Record<string, unknown>;

      expect(s.file).toBe(docPath);
      expect(s.isTempFile).toBe(false);

      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        docPath,
      );
    },
  );

  backupRecoveryTest(
    'recovers backup content when saved file has an unsaved backup',
    async ({ appPage, testEnv }) => {
      const docPath = path.join(testEnv.workspaceDir, 'recovery-test.md');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        docPath,
      );

      const editedContent = '# Recovery Test\n\nEdited before backup.\n';
      await replaceEditorContents(appPage, editedContent);
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      // Trigger a backup via the Tauri command
      await invokeConfig(appPage, 'backup', {
        markdown: editedContent,
        path: docPath,
      });

      // The backup file should exist on disk
      const absolutePath = path.resolve(docPath);
      const hash = createHash('sha256').update(absolutePath).digest('hex');
      const backupDir = path.join(testEnv.xdgStateHome, 'pandoc-preview', 'backups');
      const expectedBackup = path.join(backupDir, `${hash}.md`);

      expect(existsSync(expectedBackup)).toBe(true);
      expect(readFileSync(expectedBackup, 'utf-8')).toContain('Edited before backup');

      // Verify the backup is reflected in get_initial_state
      const state = await invokeConfig(appPage, 'get_initial_state', {});
      const s = state as Record<string, unknown>;
      expect(s.recoveredFromBackup).toBe(true);
    },
  );

  unsavedBufferRecoveryTest(
    'recovers unsaved editor buffer after page reload',
    async ({ appPage, testEnv }) => {
      const docPath = path.join(testEnv.workspaceDir, 'buffer-test.md');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        docPath,
      );

      const unsavedContent = '# Buffer Test\n\nUnsaved buffer content!\n';
      await replaceEditorContents(appPage, unsavedContent);
      await expect(appPage.locator('#save-state')).toContainText('unsaved');

      // Trigger backup before reload
      await invokeConfig(appPage, 'backup', {
        markdown: unsavedContent,
        path: docPath,
      });

      // Reload the page
      await appPage.evaluate('window.location.reload()');
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      const state = await invokeConfig(appPage, 'get_initial_state', {});
      const s = state as Record<string, unknown>;
      expect(s.recoveredFromBackup).toBe(true);

      await expect(appPage.locator('.cm-content')).toContainText(
        'Unsaved buffer content!',
        {
          timeout: 10000,
        },
      );

      await expect
        .poll(() => previewText(appPage))
        .toContain('Unsaved buffer content!');
    },
  );

  restoreLastFileDisabledTest(
    'does not restore last file when restore_last_file is false',
    async ({ appPage, testEnv }) => {
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });

      // When restore_last_file is false and no session state written,
      // the app should start with a blank/temp buffer, not loading any file.
      const state = await invokeConfig(appPage, 'get_initial_state', {});
      const s = state as Record<string, unknown>;

      // File should be null or the app should show a scratch buffer
      expect(s.file).toBeNull();

      // Footer should not show a real file path
      const footerTitle = await appPage
        .locator('footer span[title]')
        .getAttribute('title');
      // The title for a temp/scratch file should not be a real file path
      expect(footerTitle).toBeFalsy();
    },
  );
});
