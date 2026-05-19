import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'net';
import { writeFileSync } from 'fs';

function getFreePort() { return new Promise((resolve, reject) => { var s = createServer(); s.listen(0, function() { resolve(s.address().port); s.close(); }); s.on('error', reject); }); }

function waitForServer(url) {
  return new Promise(function(resolve, reject) {
    function check() { fetch(url + '/api/status').then(function(r) { if (r.ok) resolve(); else setTimeout(check, 100); }).catch(function() { setTimeout(check, 100); }); }
    check();
    setTimeout(function() { reject(new Error('timeout')); }, 15000);
  });
}

async function measure(page) {
  return JSON.parse(await page.evaluate('(function(){'+
    'var ids={app:"app",panes:"panes",toolbar:"toolbar",terminalPane:"terminal-pane",previewPane:"preview-pane"};'+
    'var cls={xterm:".xterm",viewport:".xterm-viewport",screen:".xterm-screen",rows:".xterm-rows"};'+
    'var all={};'+
    'Object.keys(ids).forEach(function(k){var e=document.getElementById(k.replace("#",""));if(e)all[k]={rect:e.getBoundingClientRect(),cs:getComputedStyle(e)};});'+
    'Object.keys(cls).forEach(function(k){var e=document.querySelector(cls[k]);if(e)all[k]={rect:e.getBoundingClientRect(),cs:getComputedStyle(e)};});'+
    'var r={};'+
    'Object.keys(all).forEach(function(k){var a=all[k];r[k]={w:a.rect.width,h:a.rect.height,t:a.rect.top,b:a.rect.bottom,hCS:a.cs.height,display:a.cs.display};});'+
    'r.toolbarH=document.getElementById("toolbar")?document.getElementById("toolbar").offsetHeight:0;'+
    'r.winH=window.innerHeight;'+
    'r.hasXterm=!!document.querySelector(".xterm");'+
    'return JSON.stringify(r);'+
  '})()'));
}

async function main() {
  var file = '/tmp/pty-test.md';
  writeFileSync(file, '# Test\n\nContent.\n');
  var port = await getFreePort();
  var proc = spawn('npx', ['tsx', 'server/cli.ts', file, '--port', '' + port, '--no-open'], {
    cwd: '/home/dzack/gitclones/pandoc-preview',
    env: Object.assign({}, process.env, { NO_OPEN: '1' }),
    stdio: 'pipe',
  });
  await waitForServer('http://localhost:' + port);

  var browser = await chromium.launch({ headless: true });

  var viewports = [
    { w: 1280, h: 600, label: 'short' },
    { w: 1280, h: 800, label: 'normal' },
    { w: 1280, h: 1080, label: 'tall' },
    { w: 1920, h: 1080, label: 'fullhd' },
  ];

  for (var vi = 0; vi < viewports.length; vi++) {
    var vp = viewports[vi];
    var page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.goto('http://localhost:' + port);
    await page.waitForSelector('#terminal-pane', { timeout: 10000 });
    await page.waitForSelector('.xterm', { timeout: 5000 });
    await page.waitForTimeout(1500);

    var m = await measure(page);
    console.log('DEBUG_MEASURE:', JSON.stringify(m));
    var fill = m.xterm && m.terminalPane ? (m.xterm.h / m.terminalPane.h * 100).toFixed(1) : 'NO_XTERM';

    console.log(vp.label + ' (' + vp.w + 'x' + vp.h + '):');
    console.log('  hasXterm=' + m.hasXterm + '  pane=' + m.terminalPane.h + 'px  xterm=' + (m.xterm ? m.xterm.h : 'N/A') + 'px  fill=' + fill + '%');
    console.log('  window=' + m.winH + 'px  toolbar=' + m.toolbarH + 'px  panes-area=' + (m.winH - m.toolbarH) + 'px  actual-panes=' + m.panes.h + 'px');

    // Now resize to a different size (as if user opened at a different window size)
    var nextVp = viewports[(vi + 1) % viewports.length];
    await page.setViewportSize({ width: nextVp.w, height: nextVp.h });
    await page.waitForTimeout(800);
    var m2 = await measure(page);
    var fill2 = m2.xterm ? (m2.xterm.h / m2.terminalPane.h * 100).toFixed(1) : 'NO_XTERM';
    console.log('  after-resize-to ' + nextVp.w + 'x' + nextVp.h + ':');
    console.log('    hasXterm=' + m2.hasXterm + '  pane=' + m2.terminalPane.h + 'px  xterm=' + (m2.xterm ? m2.xterm.h : 'N/A') + 'px  fill=' + fill2 + '%');

    await page.close();
  }

  // Test: load directly at a large size
  console.log('\n=== DIRECT LOAD AT LARGE SIZE ===');
  var p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('http://localhost:' + port);
  await p.waitForSelector('#terminal-pane', { timeout: 10000 });
  await p.waitForSelector('.xterm', { timeout: 5000 });
  await p.waitForTimeout(1500);
  var m = await measure(p);
  console.log('Direct 1920x1080: fill=' + (m.xterm.h / m.terminalPane.h * 100).toFixed(1) + '%');
  await p.screenshot({ path: '/tmp/pandoc-1920.png' });

  // Test: load small, expand to large (simulates user opening big browser)
  console.log('\n=== LOAD AT SMALL, EXPAND TO LARGE ===');
  var p2 = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await p2.goto('http://localhost:' + port);
  await p2.waitForSelector('#terminal-pane', { timeout: 10000 });
  await p2.waitForSelector('.xterm', { timeout: 5000 });
  await p2.waitForTimeout(1500);
  var m = await measure(p2);
  console.log('At 800x500: fill=' + (m.xterm.h / m.terminalPane.h * 100).toFixed(1) + '%');

  await p2.setViewportSize({ width: 1920, height: 1080 });
  await p2.waitForTimeout(1500);
  var m2 = await measure(p2);
  console.log('After expand: fill=' + (m2.xterm.h / m2.terminalPane.h * 100).toFixed(1) + '%');
  await p2.screenshot({ path: '/tmp/pandoc-expanded.png' });

  await browser.close();
  proc.kill('SIGTERM');
  console.log('\nScreenshots: /tmp/pandoc-1920.png, /tmp/pandoc-expanded.png');
}
main().catch(function(err) { console.error(err); process.exit(1); });
