import { expect, test } from './fixtures.js';

test.describe('App shell asset loading', () => {
  test('loads compiled JS and CSS assets, not raw source', async ({ appPage }) => {
    await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
    await expect(appPage.locator('#status')).toContainText('ready', { timeout: 15000 });

    // Use evaluate(string) to get script src attributes
    const scripts: string[] = (await appPage.evaluate(
      `Array.from(document.querySelectorAll('script[src]')).map(el => el.getAttribute('src') ?? '')`,
    )) as string[];

    for (const src of scripts) {
      if (!src) continue;
      expect(src).not.toMatch(/\.tsx$/);
    }

    const hasCompiledJs = scripts.some(
      (src) => src && (src.includes('/assets/') || src.includes('.js')),
    );
    expect(hasCompiledJs).toBe(true);

    // Use evaluate(string) to get stylesheet href attributes
    const stylesheets: string[] = (await appPage.evaluate(
      `Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(el => el.getAttribute('href') ?? '')`,
    )) as string[];

    const hasCompiledCss = stylesheets.some(
      (href) => href && (href.includes('/assets/') || href.endsWith('.css')),
    );
    expect(hasCompiledCss).toBe(true);
  });
});
