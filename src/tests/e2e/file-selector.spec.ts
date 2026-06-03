import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { TauriPage } from '@srsholmes/tauri-playwright';

import { expect, test } from './fixtures.js';
import { invokeTauri, previewText } from './editor-helpers.js';

function fileSelector(appPage: TauriPage) {
  return appPage.getByTestId('file-selector-dialog');
}

async function clickDirInSelector(appPage: TauriPage, name: string) {
  await fileSelector(appPage)
    .getByTestId('file-selector-dir')
    .filter({ hasText: name })
    .first()
    .click();
}

async function clickFileInSelector(appPage: TauriPage, name: string) {
  await fileSelector(appPage)
    .getByTestId('file-selector-file')
    .filter({ hasText: name })
    .first()
    .click();
}

async function submitSelectorWithName(appPage: TauriPage, filename: string) {
  const input = fileSelector(appPage).locator(
    'input[data-testid="file-selector-input"]',
  );
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.fill(filename);
  await fileSelector(appPage).getByTestId('file-selector-save').click();
}

const selectorTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const dir = path.join(testEnv.workspaceDir, 'selector-test');
    const sub = path.join(dir, 'subdir');
    mkdirSync(sub, { recursive: true });

    const initial = path.join(dir, 'initial.md');
    writeFileSync(initial, '# Initial', 'utf-8');
    writeFileSync(path.join(sub, 'existing.md'), '# Existing', 'utf-8');

    testEnv.writeSessionState(initial, false);

    await use(testEnv);
  },
});

test.describe('file selector dialog', () => {
  selectorTest(
    'Save As dialog shows workspace tree, navigates into subdirectory, and saves file there',
    async ({ appPage, testEnv }) => {
      const dir = path.join(testEnv.workspaceDir, 'selector-test');
      const sub = path.join(dir, 'subdir');
      const initial = path.join(dir, 'initial.md');

      await expect(appPage.locator('#editor .cm-content')).toBeVisible({
        timeout: 5000,
      });

      // Wait for the initial render to settle
      await expect
        .poll(() => previewText(appPage), { timeout: 5000 })
        .toContain('Initial');

      await appPage.keyboard.press('Control+Shift+S');
      await expect(fileSelector(appPage)).toBeVisible({ timeout: 3000 });

      await expect(fileSelector(appPage).getByTestId('breadcrumb')).toContainText(
        path.basename(dir),
      );

      await expect(
        fileSelector(appPage)
          .getByTestId('file-selector-dir')
          .filter({ hasText: 'subdir' }),
      ).toBeVisible();

      await clickDirInSelector(appPage, 'subdir');

      await expect(fileSelector(appPage).getByTestId('breadcrumb')).toContainText(
        'subdir',
      );

      await expect(
        fileSelector(appPage)
          .getByTestId('file-selector-file')
          .filter({ hasText: 'existing.md' }),
      ).toBeVisible();

      await submitSelectorWithName(appPage, 'saved-in-subdir.md');

      await expect(fileSelector(appPage)).toHaveCount(0);

      // Verify the file was saved to disk under subdir
      const expectedPath = path.join(sub, 'saved-in-subdir.md');
      await expect
        .poll(() => existsSync(expectedPath), { timeout: 5000, intervals: [100, 200] })
        .toBe(true);

      expect(readFileSync(expectedPath, 'utf-8')).toBe('# Initial');
    },
  );

  test('browse IPC returns directory listing with parent path', async ({
    appPage,
    testEnv,
  }) => {
    const dir = path.join(testEnv.workspaceDir, 'browse-test');
    mkdirSync(path.join(dir, 'alpha'), { recursive: true });
    writeFileSync(path.join(dir, 'beta.md'), '# Beta', 'utf-8');

    const result = (await invokeTauri(appPage, 'browse', { dir })) as {
      dir: string;
      parent: string;
      entries: Array<{ name: string }>;
    };

    expect(result.dir).toBe(dir);
    expect(typeof result.parent).toBe('string');
    const names = result.entries.map((e) => e.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta.md');
  });

  const clickFileTest = test.extend({
    testEnv: async ({ testEnv }, use) => {
      const dir = path.join(testEnv.workspaceDir, 'selector-click-test');
      mkdirSync(dir, { recursive: true });

      const initial = path.join(dir, 'initial.md');
      writeFileSync(initial, '# Click Test', 'utf-8');
      writeFileSync(path.join(dir, 'target.md'), '# Target', 'utf-8');

      testEnv.writeSessionState(initial, false);

      await use(testEnv);
    },
  });

  clickFileTest(
    'clicking a file row in the selector populates the filename input',
    async ({ appPage, testEnv }) => {
      await expect(appPage.locator('#editor .cm-content')).toBeVisible({
        timeout: 5000,
      });

      await expect
        .poll(() => previewText(appPage), { timeout: 5000 })
        .toContain('Click Test');

      await appPage.keyboard.press('Control+Shift+S');
      await expect(fileSelector(appPage)).toBeVisible({ timeout: 3000 });

      await clickFileInSelector(appPage, 'target.md');

      const input = fileSelector(appPage).locator(
        'input[data-testid="file-selector-input"]',
      );
      await expect(input).toHaveValue('target.md');
    },
  );
});
