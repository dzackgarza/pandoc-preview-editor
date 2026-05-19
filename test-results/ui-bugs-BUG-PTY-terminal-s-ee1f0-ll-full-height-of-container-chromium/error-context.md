# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-bugs.spec.ts >> BUG: PTY terminal should fill full height of container
- Location: tests/ui-bugs.spec.ts:12:1

# Error details

```
ReferenceError: launchServer is not defined
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | let server: Awaited<ReturnType<typeof launchServer>>;
  4   | 
  5   | test.afterEach(async () => {
  6   |   if (server) {
  7   |     await killServer(server);
  8   |     // cleanup handled by server
  9   |   }
  10  | });
  11  | 
  12  | test('BUG: PTY terminal should fill full height of container', async ({ page }) => {
  13  |   // Start server with a test file
  14  |   const file = '/tmp/pty-height-test.md';
  15  |   const { writeFileSync } = await import('node:fs');
  16  |   writeFileSync(file, '# Test\n\nContent here.\n');
  17  | 
> 18  |   server = await launchServer(file);
      |   ^ ReferenceError: launchServer is not defined
  19  | 
  20  |   // Navigate to the app
  21  |   await page.goto(server.url);
  22  |   await page.waitForSelector('[data-testid="terminal"]', { timeout: 15000 });
  23  |   await page.waitForTimeout(1000); // Wait for initial layout
  24  | 
  25  |   // Try multiple viewport sizes to trigger the bug
  26  |   const viewports = [
  27  |     { width: 1024, height: 768 },
  28  |     { width: 800, height: 600 },
  29  |     { width: 1280, height: 800 },
  30  |     { width: 1920, height: 1080 },
  31  |   ];
  32  | 
  33  |   for (const vp of viewports) {
  34  |     await page.setViewportSize(vp);
  35  |     await page.waitForTimeout(300);
  36  | 
  37  |     // Get the terminal container element
  38  |     const terminalPane = page.locator('#terminal-pane');
  39  |     await expect(terminalPane).toBeVisible();
  40  | 
  41  |     // Get the xterm element (the actual terminal)
  42  |     const xtermElement = page.locator('.xterm');
  43  |     await expect(xtermElement).toBeVisible();
  44  | 
  45  |     // Also check xterm-viewport which handles scrolling
  46  |     const xtermViewport = page.locator('.xterm-viewport');
  47  |     await expect(xtermViewport).toBeVisible();
  48  | 
  49  |     // Check the actual terminal content height vs container
  50  |     // The bug: there may be empty space below the terminal content
  51  |     const hasEmptySpace = await page.evaluate(() => {
  52  |       const terminalPane = document.getElementById('terminal-pane');
  53  |       const xterm = document.querySelector('.xterm');
  54  |       const xtermViewport = document.querySelector('.xterm-viewport');
  55  |       if (!terminalPane || !xterm || !xtermViewport) return null;
  56  | 
  57  |       const paneRect = terminalPane.getBoundingClientRect();
  58  |       const xtermRect = xterm.getBoundingClientRect();
  59  |       const viewportRect = xtermViewport.getBoundingClientRect();
  60  | 
  61  |       // Check if there's a gap at the bottom of the terminal
  62  |       const bottomGap = paneRect.bottom - viewportRect.bottom;
  63  |       const topGap = xtermRect.top - paneRect.top;
  64  | 
  65  |       return {
  66  |         paneHeight: paneRect.height,
  67  |         xtermHeight: xtermRect.height,
  68  |         viewportHeight: viewportRect.height,
  69  |         topGap,
  70  |         bottomGap,
  71  |         hasTopGap: topGap > 5,
  72  |         hasBottomGap: bottomGap > 5,
  73  |       };
  74  |     });
  75  | 
  76  |     console.log('Gap analysis:', JSON.stringify(hasEmptySpace, null, 2));
  77  | 
  78  |     // The bug: there might be extra space at top or bottom
  79  |     expect(hasEmptySpace?.hasTopGap, 'Terminal should have no top gap (padding)').toBe(
  80  |       false,
  81  |     );
  82  | 
  83  |     expect(
  84  |       hasEmptySpace?.hasBottomGap,
  85  |       'Terminal should have no bottom gap - PTY should be full height',
  86  |     ).toBe(false);
  87  | 
  88  |     // Measure heights
  89  |     const containerBounds = await terminalPane.boundingBox();
  90  |     const xtermBounds = await xtermElement.boundingBox();
  91  |     const viewportBounds = await xtermViewport.boundingBox();
  92  | 
  93  |     expect(containerBounds, 'terminal pane must be visible').not.toBeNull();
  94  |     expect(xtermElement, 'xterm must be visible').not.toBeNull();
  95  |     expect(viewportBounds, 'xterm-viewport must be visible').not.toBeNull();
  96  | 
  97  |     const containerHeight = containerBounds!.height;
  98  |     const xtermHeight = xtermBounds!.height;
  99  | 
  100 |     // The xterm viewport should fill at least 95% of the container height
  101 |     // This test should FAIL (red) confirming the bug
  102 |     const viewportHeight = viewportBounds!.height;
  103 |     const fillRatio = viewportHeight / containerHeight;
  104 | 
  105 |     console.log(`Container height: ${containerHeight}px`);
  106 |     console.log(`Xterm height: ${xtermHeight}px`);
  107 |     console.log(`Viewport height: ${viewportHeight}px`);
  108 |     console.log(`Fill ratio: ${fillRatio * 100}%`);
  109 | 
  110 |     expect(
  111 |       fillRatio,
  112 |       `PTY viewport should fill at least 95% of container height, got ${(fillRatio * 100).toFixed(1)}%`,
  113 |     ).toBeGreaterThan(0.95);
  114 |   } // end for viewport loop
  115 | });
  116 | 
```