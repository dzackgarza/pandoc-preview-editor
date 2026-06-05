import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { TauriLocator } from '@srsholmes/tauri-playwright';

import { expect, test } from './fixtures.js';
import {
  replaceEditorContents,
  previewText,
  saveViaFileSelector,
  type AppPage,
} from './editor-helpers.js';

async function ensureExplorerEntryVisible(
  explorerDrawer: TauriLocator,
  branchName: string,
  entryName: string,
) {
  const isVisibleScript = `
    (el) => Array.from(el.querySelectorAll('button')).some((button) => {
      return button.offsetParent !== null && button.textContent?.trim() === ${JSON.stringify(entryName)};
    })
  `;
  const visible = await explorerDrawer.evaluate(isVisibleScript);

  if (!visible) {
    await clickExplorerRow(explorerDrawer, branchName);
    await expect.poll(() => explorerDrawer.evaluate(isVisibleScript)).toBe(true);
  }
}

async function clickExplorerRow(explorerDrawer: TauriLocator, label: string) {
  await explorerDrawer.evaluate(`
    (el) => {
      const target = Array.from(el.querySelectorAll('button')).find((button) => {
        return button.offsetParent !== null && button.textContent?.trim() === ${JSON.stringify(label)};
      });
      if (!target) {
        throw new Error('Explorer row ${label} is not visible');
      }
      target.click();
    }
  `);
}

const savedFileTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const notesDir = path.join(testEnv.workspaceDir, 'notes');
    mkdirSync(notesDir, { recursive: true });

    const documentPath = path.join(notesDir, 'proof.md');
    writeFileSync(
      documentPath,
      '# Launch proof\n\nInitial content from disk.\n',
      'utf8',
    );
    testEnv.writeSessionState(documentPath, false);

    await use(testEnv);
  },
});

const explorerWorkflowTest = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const nestedDir = path.join(testEnv.workspaceDir, 'nested');
    const ignoredDir = path.join(testEnv.workspaceDir, 'node_modules');

    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(ignoredDir, { recursive: true });

    const proofPath = path.join(testEnv.workspaceDir, 'proof.md');
    writeFileSync(proofPath, '# Proof file\n\nOriginal proof content.\n', 'utf8');
    writeFileSync(
      path.join(nestedDir, 'second.md'),
      '# Second file\n\nSecond file from explorer.\n',
      'utf8',
    );
    writeFileSync(
      path.join(nestedDir, 'third.md'),
      '# Third file\n\nThird file from explorer.\n',
      'utf8',
    );
    writeFileSync(path.join(testEnv.workspaceDir, '.hidden.md'), 'hidden', 'utf8');
    writeFileSync(path.join(ignoredDir, 'ignored.md'), 'ignored', 'utf8');
    writeFileSync(
      path.join(testEnv.workspaceDir, 'image.bin'),
      Buffer.from([0, 255, 17, 99]),
    );
    testEnv.writeSessionState(proofPath, false);

    await use(testEnv);
  },
});

test.describe('desktop file workflows', () => {
  test.describe('saved-file launch, save, and reload', () => {
    savedFileTest(
      'keeps real file identity across edit, save, and reload',
      async ({ appPage, testEnv }) => {
        const documentPath = path.join(testEnv.workspaceDir, 'notes', 'proof.md');
        const updatedMarkdown =
          '# Launch proof\n\nEdited from the real desktop workflow.\n';

        await expect(appPage.getByTestId('editor')).toBeVisible();
        await expect(appPage.locator('footer span[title]')).toHaveAttribute(
          'title',
          documentPath,
        );
        await expect(appPage.locator('.cm-content')).toContainText(
          'Initial content from disk.',
        );
        await expect.poll(() => previewText(appPage)).toContain('Launch proof');
        await expect
          .poll(() => previewText(appPage))
          .toContain('Initial content from disk.');

        await replaceEditorContents(appPage, updatedMarkdown);
        await expect(appPage.locator('#save-state')).toContainText('unsaved');
        await expect
          .poll(() => previewText(appPage))
          .toContain('Edited from the real desktop workflow.');

        await appPage.locator('button[aria-label="Save"]').click();
        await expect(appPage.locator('#save-state')).toContainText('saved');
        await expect(appPage.locator('footer span[title]')).toHaveAttribute(
          'title',
          documentPath,
        );
        await expect(readFileSync(documentPath, 'utf8')).toBe(updatedMarkdown);

        await appPage.reload();
        await expect(appPage.getByTestId('editor')).toBeVisible();
        await expect(appPage.locator('#status')).toContainText('ready');
        await expect(appPage.locator('footer span[title]')).toHaveAttribute(
          'title',
          documentPath,
        );
        await expect(appPage.locator('.cm-content')).toContainText(
          'Edited from the real desktop workflow.',
        );
        await expect
          .poll(() => previewText(appPage))
          .toContain('Edited from the real desktop workflow.');
      },
    );

    savedFileTest(
      'save as keeps or moves the workspace root exactly',
      async ({ appPage, testEnv }) => {
        const insidePath = path.join(
          testEnv.workspaceDir,
          'notes',
          'inside-save-as.md',
        );
        const outsideDir = path.join(testEnv.rootDir, 'outside-workspace');
        const outsidePath = path.join(outsideDir, 'outside-save-as.md');

        mkdirSync(outsideDir, { recursive: true });

        await expect(appPage.getByTestId('editor')).toBeVisible();
        await expect(appPage.locator('footer span[title]')).toHaveAttribute(
          'title',
          path.join(testEnv.workspaceDir, 'notes', 'proof.md'),
        );
        await expect
          .poll(() => previewText(appPage))
          .toContain('Initial content from disk.');

        await replaceEditorContents(
          appPage,
          '# Save As proof\n\nInside workspace target.\n',
        );
        await expect(appPage.locator('#save-state')).toContainText('unsaved');
        await expect
          .poll(() => previewText(appPage))
          .toContain('Inside workspace target.');
        await appPage.keyboard.press('Control+Shift+S');
        await saveViaFileSelector(appPage, insidePath);
        await expect(appPage.locator('#save-state')).toContainText('saved');
        await expect(appPage.locator('footer span[title]')).toHaveAttribute(
          'title',
          insidePath,
        );
        await expect(readFileSync(insidePath, 'utf8')).toBe(
          '# Save As proof\n\nInside workspace target.\n',
        );

        await appPage.locator('button[aria-label="File Explorer"]').click();
        await expect(appPage.getByTestId('explorer-drawer')).toBeVisible();
        await expect(appPage.getByTestId('explorer-drawer')).toContainText(
          testEnv.workspaceDir,
        );

        await replaceEditorContents(
          appPage,
          '# Save As proof\n\nOutside workspace target.\n',
        );
        await expect(appPage.locator('#save-state')).toContainText('unsaved');
        await expect
          .poll(() => previewText(appPage))
          .toContain('Outside workspace target.');
        await appPage.keyboard.press('Control+Shift+S');
        await saveViaFileSelector(appPage, outsidePath);
        await expect(appPage.locator('#save-state')).toContainText('saved');
        await expect(appPage.locator('footer span[title]')).toHaveAttribute(
          'title',
          outsidePath,
        );
        await expect(readFileSync(outsidePath, 'utf8')).toBe(
          '# Save As proof\n\nOutside workspace target.\n',
        );
        await expect(appPage.getByTestId('explorer-drawer')).toContainText(outsideDir);
        await expect(appPage.getByTestId('explorer-drawer')).not.toContainText(
          testEnv.workspaceDir,
        );
      },
    );
  });

  test.describe('explorer ownership and dirty replacement', () => {
    explorerWorkflowTest(
      'explorer filters debris and makes saves target the opened file',
      async ({ appPage, testEnv }) => {
        const proofPath = path.join(testEnv.workspaceDir, 'proof.md');
        const secondPath = path.join(testEnv.workspaceDir, 'nested', 'second.md');
        const explorerDrawer = appPage.getByTestId('explorer-drawer');

        await expect(appPage.getByTestId('editor')).toBeVisible();
        await expect(appPage.locator('footer span[title]')).toHaveAttribute(
          'title',
          proofPath,
        );
        await expect
          .poll(() => previewText(appPage))
          .toContain('Original proof content.');

        await appPage.locator('button[aria-label="File Explorer"]').click();
        await expect(explorerDrawer).toBeVisible();
        await expect(explorerDrawer).toContainText('proof.md');
        await expect(explorerDrawer).toContainText('nested');
        await expect(explorerDrawer).not.toContainText('.hidden.md');
        await expect(explorerDrawer).not.toContainText('node_modules');
        await expect(explorerDrawer).not.toContainText('image.bin');

        await ensureExplorerEntryVisible(explorerDrawer, 'nested', 'second.md');
        await clickExplorerRow(explorerDrawer, 'second.md');
        await expect(appPage.locator('footer span[title]')).toHaveAttribute(
          'title',
          secondPath,
        );
        await expect(appPage.locator('.cm-content')).toContainText(
          'Second file from explorer.',
        );
        await expect
          .poll(() => previewText(appPage))
          .toContain('Second file from explorer.');
        await expect(readFileSync(proofPath, 'utf8')).toBe(
          '# Proof file\n\nOriginal proof content.\n',
        );

        await replaceEditorContents(
          appPage,
          '# Second file\n\nSaved after explorer switch.\n',
        );
        await expect(appPage.locator('#save-state')).toContainText('unsaved');
        await expect
          .poll(() => previewText(appPage))
          .toContain('Saved after explorer switch.');
        await appPage.locator('button[aria-label="Save"]').click();
        await expect(appPage.locator('#save-state')).toContainText('saved');
        await expect(readFileSync(secondPath, 'utf8')).toBe(
          '# Second file\n\nSaved after explorer switch.\n',
        );
        await expect(readFileSync(proofPath, 'utf8')).toBe(
          '# Proof file\n\nOriginal proof content.\n',
        );
      },
    );
  });
});
