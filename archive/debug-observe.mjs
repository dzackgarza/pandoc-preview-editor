import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url + '/api/status');
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Server not ready');
}

async function main() {
  const file = '/tmp/pty-observe-test.md';
  writeFileSync(file, '# Test Document\n\nSome content here.\n');

  const port = await getFreePort();
  console.log('Starting server on port', port);

  const proc = spawn('npx', ['tsx', 'server/cli.ts', file, '--port', String(port), '--no-open'], {
    cwd: '/home/dzack/gitclones/pandoc-preview',
    env: { ...process.env, NO_OPEN: '1' },
    stdio: 'pipe',
  });
  proc.stdout.on('data', d => process.stdout.write('[server] ' + d));
  proc.stderr.on('data', d => process.stderr.write('[server-err] ' + d));

  await waitForServer('http://localhost:' + port, 15000);
  console.log('Server ready');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('console', msg => console.log('[browser ' + msg.type() + '] ' + msg.text()));
  page.on('pageerror', err => console.log('[browser error] ' + err.message));

  await page.goto('http://localhost:' + port);
  await page.waitForSelector('#terminal-pane', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Screenshot
  await page.screenshot({ path: '/tmp/pandoc-bug-fullpage.png' });
  console.log('Screenshot: /tmp/pandoc-bug-fullpage.png');

  // Pass measurements as a string that gets evaluated in the page context
  const measures = await page.evaluate(`(function() {
    var pane = document.getElementById('terminal-pane');
    var preview = document.getElementById('preview-pane');
    var xterm = document.querySelector('.xterm');
    var viewport = document.querySelector('.xterm-viewport');
    var parent = pane ? pane.parentElement : null;

    function r(el) {
      if (!el) return null;
      var b = el.getBoundingClientRect();
      return { w: b.width, h: b.height, t: b.top, l: b.left, b: b.bottom, r: b.right };
    }

    return JSON.stringify({
      window: { w: window.innerWidth, h: window.innerHeight },
      terminalPane: r(pane),
      previewPane: r(preview),
      xterm: r(xterm),
      xtermViewport: r(viewport),
      parentCSS: parent ? { display: getComputedStyle(parent).display, fd: getComputedStyle(parent).flexDirection, h: getComputedStyle(parent).height } : null,
      paneCSS: pane ? { display: getComputedStyle(pane).display, flex: getComputedStyle(pane).flex, h: getComputedStyle(pane).height, minH: getComputedStyle(pane).minHeight, overflow: getComputedStyle(pane).overflow, flexGrow: getComputedStyle(pane).flexGrow } : null,
      xtermCSS: xterm ? { h: getComputedStyle(xterm).height, maxH: getComputedStyle(xterm).maxHeight } : null,
      viewportCSS: viewport ? { h: getComputedStyle(viewport).height } : null,
    });
  })()`);
  const data = JSON.parse(measures);

  console.log('\n=== LAYOUT ===');
  console.log(JSON.stringify(data, null, 2));

  if (data.xtermViewport && data.terminalPane) {
    var fill = (data.xtermViewport.h / data.terminalPane.h * 100).toFixed(1);
    console.log('\nFill ratio: ' + fill + '%');
  }
  if (data.xterm && data.terminalPane) {
    console.log('Gaps: top=' + (data.xterm.t - data.terminalPane.t).toFixed(0) + 'px, bottom=' + (data.terminalPane.b - data.xterm.b).toFixed(0) + 'px');
  }

  console.log('\nBrowser open for 30s for visual inspection...');
  await page.waitForTimeout(30000);

  await browser.close();
  proc.kill('SIGTERM');
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
