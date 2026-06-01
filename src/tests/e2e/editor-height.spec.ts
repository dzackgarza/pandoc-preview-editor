import { expect, test } from './fixtures.js';

test.describe('editor height', () => {
  test('editor fills available height, not just content height', async ({
    appPage,
    testEnv,
  }) => {
    await expect(appPage.locator('#editor')).toBeVisible({ timeout: 5000 });

    const sectionBox = await appPage.locator('#editor').boundingBox();
    const cmBox = await appPage.locator('#editor .cm-editor').boundingBox();
    const cmThemeBox = await appPage.locator('#editor .cm-theme-dark').boundingBox();

    if (!sectionBox || !cmBox || !cmThemeBox) {
      throw new Error('Could not get bounding boxes');
    }

    // The cm-theme-dark wrapper and cm-editor should fill the available area,
    // not collapse to ~27px (one line of content). The section is ~648px with
    // a ~40px header, leaving ~608px for the editor area.
    expect(cmThemeBox.height, 'cm-theme-dark height').toBeGreaterThan(100);
    expect(cmBox.height, 'cm-editor height').toBeGreaterThan(100);

    // After setting minimal content, the container should still fill the space
    await appPage.locator('#editor .cm-content').click();
    await appPage.keyboard.press('Control+A');
    await appPage.keyboard.press('Backspace');
    await appPage.keyboard.insertText('x');
    await appPage.waitForTimeout(200);

    const cmBoxAfter = await appPage.locator('#editor .cm-editor').boundingBox();
    if (!cmBoxAfter) throw new Error('Could not get cm-editor box after clearing');
    expect(cmBoxAfter.height, 'cm-editor after clearing').toBeGreaterThan(100);
  });
});
