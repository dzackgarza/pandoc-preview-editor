/**
 * Minimal headed diagnostic: start server, open browser, check data flow.
 * Run: npx tsx tests/repro-headed.ts
 */
import { chromium } from 'playwright';
import { launchServer, killServer } from './helpers.js';

async function main() {
  const server = await launchServer('tests/fixtures/test-doc.md');
  console.log('SERVER LOG:');
  for (const l of server.out) process.stdout.write('  ' + l);
  for (const l of server.err) process.stderr.write('  ' + l);

  const browser = await chromium.launch({
    headless: false, // headed
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('console', (msg) => console.log(`[browser ${msg.type()}] ${msg.text()}`));
  page.on('response', (resp) => {
    if (resp.status() >= 400) console.log(`[browser ${resp.status()}] ${resp.url()}`);
  });

  await page.goto(server.url, { waitUntil: 'networkidle' });

  // Wait for terminal to appear
  await page.waitForSelector('#terminal-pane .xterm', { timeout: 15000 });

  // Measure at T+500ms and T+3000ms
  for (const label of ['T+500ms', 'T+3000ms']) {
    await page.waitForTimeout(label === 'T+500ms' ? 500 : 2500);
    const diag = await page.evaluate(() => {
      const el = document.querySelector('.xterm-rows');
      return {
        rowsText: el?.textContent?.slice(0, 500) ?? null,
        rowCount: el?.children.length ?? 0,
        viewport: document.querySelector('.xterm-viewport')?.getBoundingClientRect(),
        screenWidth: document.querySelector('.xterm-screen')?.getBoundingClientRect()
          .width,
      };
    });
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(diag, null, 2));
  }

  const shot = await page.locator('#terminal-pane').screenshot();
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/headed-repro.png', shot);
  console.log(`\nScreenshot: ${shot.length} bytes -> /tmp/headed-repro.png`);

  // Tail server log
  console.log('\n=== SERVER LOG TAIL ===');
  for (const l of server.out.slice(-20)) process.stdout.write('  ' + l);
  for (const l of server.err.slice(-10)) process.stderr.write('  ' + l);

  await browser.close();
  await killServer(server);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
