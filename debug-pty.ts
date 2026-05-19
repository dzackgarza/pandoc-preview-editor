import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Navigate to the app
  await page.goto('http://localhost:3143');
  await page.waitForSelector('#terminal-pane', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Get heights
  const result = await page.evaluate(() => {
    const pane = document.getElementById('terminal-pane');
    const preview = document.getElementById('preview-pane');
    const xterm = document.querySelector('.xterm');
    const xtermViewport = document.querySelector('.xterm-viewport');

    return {
      paneHeight: pane?.getBoundingClientRect().height,
      previewHeight: preview?.getBoundingClientRect().height,
      xtermHeight: xterm?.getBoundingClientRect().height,
      viewportHeight: xtermViewport?.getBoundingClientRect().height,
    };
  });

  console.log(result);

  await page.screenshot({ path: '/tmp/pty-debug.png' });
  console.log('Screenshot saved to /tmp/pty-debug.png');

  await browser.close();
}

main().catch(console.error);
