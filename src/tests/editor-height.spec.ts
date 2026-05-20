import { test, expect } from '@playwright/test';
import { launchServer, killServer, type ServerInstance } from './helpers.js';

let server: ServerInstance;

test.describe('editor height', () => {
  test.beforeAll(async () => {
    server = await launchServer();
  });

  test.afterAll(async () => {
    if (server) await killServer(server);
  });

  test('editor fills available height, not just content height', async ({ page }) => {
    await page.goto(server.url);

    const editorSection = page.locator('#editor');
    await expect(editorSection).toBeVisible({ timeout: 5000 });

    const sectionBox = await editorSection.boundingBox();
    const cmEditor = page.locator('#editor .cm-editor');
    const cmBox = await cmEditor.boundingBox();
    const cmThemeDark = page.locator('#editor .cm-theme-dark');
    const cmThemeBox = await cmThemeDark.boundingBox();

    if (!sectionBox || !cmBox || !cmThemeBox) {
      throw new Error('Could not get bounding boxes');
    }

    // The cm-theme-dark wrapper and cm-editor should fill the available area,
    // not collapse to ~27px (one line of content). The section is ~648px with
    // a ~40px header, leaving ~608px for the editor area.
    expect(cmThemeBox.height, 'cm-theme-dark height').toBeGreaterThan(100);
    expect(cmBox.height, 'cm-editor height').toBeGreaterThan(100);

    // After setting minimal content, the container should still fill the space
    await page.locator('#editor .cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('x');
    await page.waitForTimeout(200);

    const cmBoxAfter = await cmEditor.boundingBox();
    if (!cmBoxAfter) throw new Error('Could not get cm-editor box after clearing');
    expect(cmBoxAfter.height, 'cm-editor after clearing').toBeGreaterThan(100);
  });
});
