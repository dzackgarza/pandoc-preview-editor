import { test, expect } from '@playwright/test';

let server: Awaited<ReturnType<typeof launchServer>>;

test.afterEach(async () => {
  if (server) {
    await killServer(server);
    // cleanup handled by server
  }
});

test('BUG: PTY terminal should fill full height of container', async ({ page }) => {
  // Start server with a test file
  const file = '/tmp/pty-height-test.md';
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, '# Test\n\nContent here.\n');

  server = await launchServer(file);

  // Navigate to the app
  await page.goto(server.url);
  await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  await page.waitForTimeout(1000); // Wait for initial layout

  // Try multiple viewport sizes to trigger the bug
  const viewports = [
    { width: 1024, height: 768 },
    { width: 800, height: 600 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(300);

    // Get the terminal container element
    const terminalPane = page.locator('#terminal-pane');
    await expect(terminalPane).toBeVisible();

    // Get the xterm element (the actual terminal)
    const xtermElement = page.locator('.xterm');
    await expect(xtermElement).toBeVisible();

    // Also check xterm-viewport which handles scrolling
    const xtermViewport = page.locator('.xterm-viewport');
    await expect(xtermViewport).toBeVisible();

    // Check the actual terminal content height vs container
    // The bug: there may be empty space below the terminal content
    const hasEmptySpace = await page.evaluate(() => {
      const terminalPane = document.getElementById('terminal-pane');
      const xterm = document.querySelector('.xterm');
      const xtermViewport = document.querySelector('.xterm-viewport');
      if (!terminalPane || !xterm || !xtermViewport) return null;

      const paneRect = terminalPane.getBoundingClientRect();
      const xtermRect = xterm.getBoundingClientRect();
      const viewportRect = xtermViewport.getBoundingClientRect();

      // Check if there's a gap at the bottom of the terminal
      const bottomGap = paneRect.bottom - viewportRect.bottom;
      const topGap = xtermRect.top - paneRect.top;

      return {
        paneHeight: paneRect.height,
        xtermHeight: xtermRect.height,
        viewportHeight: viewportRect.height,
        topGap,
        bottomGap,
        hasTopGap: topGap > 5,
        hasBottomGap: bottomGap > 5,
      };
    });

    console.log('Gap analysis:', JSON.stringify(hasEmptySpace, null, 2));

    // The bug: there might be extra space at top or bottom
    expect(hasEmptySpace?.hasTopGap, 'Terminal should have no top gap (padding)').toBe(
      false,
    );

    expect(
      hasEmptySpace?.hasBottomGap,
      'Terminal should have no bottom gap - PTY should be full height',
    ).toBe(false);

    // Measure heights
    const containerBounds = await terminalPane.boundingBox();
    const xtermBounds = await xtermElement.boundingBox();
    const viewportBounds = await xtermViewport.boundingBox();

    expect(containerBounds, 'terminal pane must be visible').not.toBeNull();
    expect(xtermElement, 'xterm must be visible').not.toBeNull();
    expect(viewportBounds, 'xterm-viewport must be visible').not.toBeNull();

    const containerHeight = containerBounds!.height;
    const xtermHeight = xtermBounds!.height;

    // The xterm viewport should fill at least 95% of the container height
    // This test should FAIL (red) confirming the bug
    const viewportHeight = viewportBounds!.height;
    const fillRatio = viewportHeight / containerHeight;

    console.log(`Container height: ${containerHeight}px`);
    console.log(`Xterm height: ${xtermHeight}px`);
    console.log(`Viewport height: ${viewportHeight}px`);
    console.log(`Fill ratio: ${fillRatio * 100}%`);

    expect(
      fillRatio,
      `PTY viewport should fill at least 95% of container height, got ${(fillRatio * 100).toFixed(1)}%`,
    ).toBeGreaterThan(0.95);
  } // end for viewport loop
});
