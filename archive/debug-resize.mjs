import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'net';
import { writeFileSync } from 'fs';

function getFreePort() {
  return new Promise((resolve, reject) => {
    var server = createServer();
    server.listen(0, function() { var port = server.address().port; server.close(function() { resolve(port); }); });
    server.on('error', reject);
  });
}

function waitForServer(url, timeoutMs) {
  var start = Date.now();
  return new Promise(function(resolve, reject) {
    function check() {
      if (Date.now() - start > timeoutMs) { reject(new Error('timeout')); return; }
      fetch(url + '/api/status').then(function(r) { if (r.ok) resolve(); else setTimeout(check, 200); }).catch(function() { setTimeout(check, 200); });
    }
    check();
  });
}

async function measurePage(page) {
  // Use string function evaluation to avoid transpiler bugs
  var raw = await page.evaluate('(function() {' +
    'var p = document.getElementById("terminal-pane");' +
    'var x = document.querySelector(".xterm");' +
    'var v = document.querySelector(".xterm-viewport");' +
    'function r(e) { if (!e) return null; var b = e.getBoundingClientRect(); return {w:b.width,h:b.height,t:b.top,b:b.bottom}; }' +
    'return JSON.stringify({term:r(p),xterm:r(x),vp:r(v)});' +
  '})()');
  return JSON.parse(raw);
}

async function main() {
  var file = '/tmp/pty-observe-test.md';
  writeFileSync(file, '# Test\n\nContent.\n');

  var port = await getFreePort();
  console.log('Server on port', port);

  var proc = spawn('npx', ['tsx', 'server/cli.ts', file, '--port', '' + port, '--no-open'], {
    cwd: '/home/dzack/gitclones/pandoc-preview',
    env: Object.assign({}, process.env, { NO_OPEN: '1' }),
    stdio: 'pipe',
  });
  proc.stdout.on('data', function(d) { process.stdout.write('[server] ' + d); });
  proc.stderr.on('data', function(d) { process.stderr.write('[server-err] ' + d); });

  await waitForServer('http://localhost:' + port, 15000);
  console.log('Ready');

  var browser = await chromium.launch({ headless: true });
  var page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  page.on('console', function(msg) { console.log('[b] ' + msg.type() + ': ' + msg.text()); });
  page.on('pageerror', function(err) { console.log('[b err]', err.message); });

  await page.goto('http://localhost:' + port);
  await page.waitForSelector('#terminal-pane', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Test various viewports
  var viewports = [
    { w: 1280, h: 800, label: '1280x800' },
    { w: 800, h: 600, label: '800x600' },
    { w: 1024, h: 768, label: '1024x768' },
    { w: 1440, h: 900, label: '1440x900' },
    { w: 1920, h: 1080, label: '1920x1080' },
  ];

  for (var i = 0; i < viewports.length; i++) {
    var vp = viewports[i];
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(800);
    var m = await measurePage(page);
    var fill = (m.vp.h / m.term.h * 100).toFixed(1);
    console.log(vp.label, '| pane=', m.term.h, 'xterm=', m.xterm.h, 'vp=', m.vp.h, '| fill=', fill + '%', '| gaps: top=', (m.xterm.t - m.term.t).toFixed(0), 'bottom=', (m.term.b - m.xterm.b).toFixed(0));
  }

  // Key test: initial load at small size, then expand to big
  console.log('\n--- Initial load small, then expand ---');
  await page.setViewportSize({ width: 1024, height: 400 });
  await page.waitForTimeout(800);
  var m = await measurePage(page);
  console.log('At 1024x400:', m.term.h, 'pane, fill=' + (m.vp.h / m.term.h * 100).toFixed(1) + '%');

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(800);
  var m = await measurePage(page);
  console.log('After expand to 1920x1080:', m.term.h, 'pane, fill=' + (m.vp.h / m.term.h * 100).toFixed(1) + '%');

  // Check what happens with the resize approach - trigger manual resize
  await page.evaluate('window.dispatchEvent(new Event("resize"))');
  await page.waitForTimeout(500);
  var m = await measurePage(page);
  console.log('After forced resize event:', m.term.h, 'pane, fill=' + (m.vp.h / m.term.h * 100).toFixed(1) + '%');

  // Log xterm terminal state
  var termInfo = await page.evaluate('(function() {' +
    'var el = document.querySelector(".xterm");' +
    'if (!el || !el.terminal) return "null";' +
    'var t = el.terminal;' +
    'return JSON.stringify({rows:t.rows,cols:t.cols,elementH:t.element?t.element.offsetHeight:null,hasFit:typeof t.fit==="function"});' +
  '})()');
  console.log('Terminal state:', termInfo);

  await page.screenshot({ path: '/tmp/pandoc-bug-tests.png' });
  console.log('\nScreenshot: /tmp/pandoc-bug-tests.png');
  await browser.close();
  proc.kill('SIGTERM');
  console.log('Done.');
}

main().catch(function(err) { console.error(err); process.exit(1); });
