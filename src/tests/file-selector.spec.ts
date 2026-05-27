import { expect, test, type Page } from '@playwright/test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { killServer, launchServer } from './helpers.js';

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

/** Locate the file selector dialog overlay. */
function fileSelector(page: Page) {
  return page.getByTestId('file-selector-dialog');
}

/** Click the named directory row inside the file selector tree. */
async function clickDirInSelector(page: Page, name: string) {
  await fileSelector(page)
    .getByTestId('file-selector-dir')
    .filter({ hasText: name })
    .first()
    .click();
}

/** Click the named file row inside the file selector tree. */
async function clickFileInSelector(page: Page, name: string) {
  await fileSelector(page)
    .getByTestId('file-selector-file')
    .filter({ hasText: name })
    .first()
    .click();
}

/** Fill the filename input and submit. */
async function submitSelectorWithName(page: Page, filename: string) {
  const input = fileSelector(page).locator('input[data-testid="file-selector-input"]');
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.fill(filename);
  await fileSelector(page).getByTestId('file-selector-save').click();
}

test.describe('file selector dialog', () => {
  let pageErrors: Error[] = [];
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    consoleErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const location = msg.location();
        const source = location.url ? ` ${location.url}:${location.lineNumber}` : '';
        consoleErrors.push(`[${msg.type()}]${source} ${msg.text()}`);
      }
    });
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== 'passed') return;
    expect(
      pageErrors,
      `page errors: ${pageErrors.map((e) => e.message).join('; ')}`,
    ).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('Save As dialog shows workspace tree, navigates into subdirectory, and saves file there', async ({
    page,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'pandoc-selector-'));
    const sub = join(dir, 'subdir');
    const initial = join(dir, 'initial.md');
    mkdirSync(sub);
    writeFileSync(initial, '# Initial', 'utf-8');
    writeFileSync(join(sub, 'existing.md'), '# Existing', 'utf-8');

    const server = await launchServer(undefined, initial);
    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
      // Wait for the initial render to settle so no dangling /api/render request
      // fires after the server is killed in finally.
      await expect(page.frameLocator('#preview').locator('h1')).toHaveText('Initial', {
        timeout: 5000,
      });

      // Open Save As via keyboard shortcut
      await page.keyboard.press('Control+Shift+S');

      // Dialog appears
      await expect(fileSelector(page)).toBeVisible({ timeout: 3000 });

      // Workspace root directory name is shown as a breadcrumb segment
      await expect(fileSelector(page).getByTestId('breadcrumb')).toContainText(
        basename(dir),
      );

      // The subdirectory appears as a navigable row
      await expect(
        fileSelector(page).getByTestId('file-selector-dir').filter({ hasText: 'subdir' }),
      ).toBeVisible();

      // Navigate into subdir by clicking it
      await clickDirInSelector(page, 'subdir');

      // Breadcrumb now shows subdir segment
      await expect(fileSelector(page).getByTestId('breadcrumb')).toContainText('subdir');

      // existing.md appears in the file list
      await expect(
        fileSelector(page)
          .getByTestId('file-selector-file')
          .filter({ hasText: 'existing.md' }),
      ).toBeVisible();

      // Type a new filename and save
      await submitSelectorWithName(page, 'saved-in-subdir.md');

      // Dialog closes
      await expect(fileSelector(page)).toHaveCount(0);

      // App now tracks the file under subdir
      const savedPath = await page.evaluate(() => window.__INITIAL_FILE);
      const expectedPath = join(sub, 'saved-in-subdir.md');

      // Poll until file appears on disk
      await expect
        .poll(() => existsSync(expectedPath), { timeout: 5000, intervals: [100, 200] })
        .toBe(true);

      expect(readFileSync(expectedPath, 'utf-8')).toBe('# Initial');
    } finally {
      await killServer(server);
      cleanupDir(dir);
    }
  });

  test('/api/browse returns directory listing with parent path for absolute dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pandoc-browse-'));
    mkdirSync(join(dir, 'alpha'));
    writeFileSync(join(dir, 'beta.md'), '# Beta', 'utf-8');

    const server = await launchServer();
    try {
      const res = await fetch(
        `${server.url}/api/browse?dir=${encodeURIComponent(dir)}`,
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        dir: string;
        parent: string | null;
        entries: { name: string; kind: string }[];
      };
      expect(data.dir).toBe(dir);
      expect(typeof data.parent).toBe('string');
      const names = data.entries.map((e) => e.name);
      expect(names).toContain('alpha');
      expect(names).toContain('beta.md');
    } finally {
      await killServer(server);
      cleanupDir(dir);
    }
  });

  test('clicking a file row in the selector populates the filename input', async ({
    page,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'pandoc-selector-click-'));
    const initial = join(dir, 'initial.md');
    writeFileSync(initial, '# Click Test', 'utf-8');
    writeFileSync(join(dir, 'target.md'), '# Target', 'utf-8');

    const server = await launchServer(undefined, initial);
    try {
      await page.goto(server.url);
      await expect(page.locator('#editor .cm-content')).toBeVisible({ timeout: 5000 });
      // Wait for the initial render to settle.
      await expect(page.frameLocator('#preview').locator('h1')).toHaveText('Click Test', {
        timeout: 5000,
      });
      await page.keyboard.press('Control+Shift+S');
      await expect(fileSelector(page)).toBeVisible({ timeout: 3000 });

      // Click a file in the current directory
      await clickFileInSelector(page, 'target.md');

      // The filename input is populated with the clicked filename
      const input = fileSelector(page).locator('input[data-testid="file-selector-input"]');
      await expect(input).toHaveValue('target.md');
    } finally {
      await killServer(server);
      cleanupDir(dir);
    }
  });
});
