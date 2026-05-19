import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'net';
import { writeFileSync } from 'fs';

function getFreePort() {
  return new Promise((resolve, reject) => {
    var server = createServer();
    server.listen(0, function() { resolve(server.address().port); server.close(); });
    server.on('error', reject);
  });
}

function waitForServer(url) {
  return new Promise(function(resolve, reject) {
    function check() {
      fetch(url + '/api/status').then(function(r) { if (r.ok) resolve(); else setTimeout(check, 200); }).catch(function() { setTimeout(check, 200); });
    }
    check();
    setTimeout(function() { reject(new Error('timeout')); }, 20000);
  });
}

async function main() {
  var file = '/tmp/pty-bug-test.md';
  writeFileSync(file, '# Bug Test\n\nContent.\n');

  var port = await getFreePort();
  console.log('Server on port', port);

  var proc = spawn('npx', ['tsx', 'server/cli.ts', file, '--port', '' + port, '--no-open'], {
    cwd: '/home/dzack/gitclones/pandoc-preview',
    env: Object.assign({}, process.env, { NO_OPEN: '1' }),
    stdio: 'pipe',
  });

  await waitForServer('http://localhost:' + port);
  console.log('Ready');

  var browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Track ALL network requests
  var allReqs = [];
  page.on('response', function(resp) {
    allReqs.push({ url: resp.url(), status: resp.status(), type: resp.request().resourceType() });
    if (resp.status() >= 400) {
      console.log('[HTTP ' + resp.status() + '] ' + resp.url());
    }
  });
  page.on('console', function(msg) { console.log('[b] ' + msg.type() + ': ' + msg.text()); });
  page.on('pageerror', function(err) { console.log('[b err]', err.message); });

  await page.goto('http://localhost:' + port);
  await page.waitForSelector('#terminal-pane', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Full layout dump
  var layout = JSON.parse(await page.evaluate('(function() {' +
    'function r(e) { if (!e) return null; var b = e.getBoundingClientRect(); return {w:b.width,h:b.height,t:b.top,l:b.left,b:b.bottom}; }' +
    'var root = document.getElementById("root") || document.getElementById("app");' +
    'var panes = document.getElementById("panes");' +
    'var toolbar = document.getElementById("toolbar");' +
    'var tp = document.getElementById("terminal-pane");' +
    'var pp = document.getElementById("preview-pane");' +
    'var xterm = document.querySelector(".xterm");' +
    'var vp = document.querySelector(".xterm-viewport");' +
    'var screen = document.querySelector(".xterm-screen");' +
    'var rows = document.querySelector(".xterm-rows");' +
    'var ft = document.querySelector(".xterm-helper-textarea");' +
    'return JSON.stringify({' +
      'win:{w:window.innerWidth,h:window.innerHeight},' +
      'scroll:{w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight},' +
      'doc:r(document.documentElement),' +
      'body:r(document.body),' +
      'app:r(root),' +
      'toolbar:r(toolbar),' +
      'panes:r(panes),' +
      'terminalPane:r(tp),' +
      'previewPane:r(pp),' +
      'xterm:r(xterm),' +
      'xtermViewport:r(vp),' +
      'xtermScreen:r(screen),' +
      'xtermRows:r(rows),' +
      'helperTextarea:r(ft),' +
      'panesCSS:panes?{display:getComputedStyle(panes).display,gridTemplateColumns:getComputedStyle(panes).gridTemplateColumns,height:getComputedStyle(panes).height}:null,' +
      'terminalCSS:tp?{display:getComputedStyle(tp).display,height:getComputedStyle(tp).height,overflow:getComputedStyle(tp).overflow,position:getComputedStyle(tp).position}:null,' +
      'xtermCSS:xterm?{display:getComputedStyle(xterm).display,height:getComputedStyle(xterm).height,padding:getComputedStyle(xterm).padding}:null,' +
      'viewportCSS:vp?{display:getComputedStyle(vp).display,height:getComputedStyle(vp).height}:null,' +
      'appCSS:root?{display:getComputedStyle(root).display,height:getComputedStyle(root).height,flexDirection:getComputedStyle(root).flexDirection}:null' +
    '});' +
  '})()'));

  console.log('\n=== FULL LAYOUT ===');
  console.log(JSON.stringify(layout, null, 2));

  // Compute fill ratio
  if (layout.xterm && layout.terminalPane) {
    var fill = (layout.xterm.h / layout.terminalPane.h * 100).toFixed(1);
    console.log('\nxterm / terminal-pane ratio: ' + fill + '%');
    console.log('top of xterm - top of pane: ' + (layout.xterm.t - layout.terminalPane.t).toFixed(0) + 'px');
    console.log('bottom of pane - bottom of xterm: ' + (layout.terminalPane.b - layout.xterm.b).toFixed(0) + 'px');
  }
  if (layout.xtermViewport && layout.terminalPane) {
    console.log('viewport / terminal-pane: ' + (layout.xtermViewport.h / layout.terminalPane.h * 100).toFixed(1) + '%');
  }

  // Screenshot for me to see
  await page.screenshot({ path: '/tmp/pandoc-headed-bug.png', fullPage: true });
  console.log('\nHeaded screenshot: /tmp/pandoc-headed-bug.png');

  // Log all network requests for debugging
  console.log('\n=== ALL NETWORK REQUESTS ===');
  for (var i = 0; i < allReqs.length; i++) {
    console.log(allReqs[i].status + ' ' + allReqs[i].url.replace('http://localhost:' + port, ''));
  }

  console.log('\nBrowser is open - 60s to inspect visually...');
  await page.waitForTimeout(60000);

  await browser.close();
  proc.kill('SIGTERM');
  console.log('Done.');
}

main().catch(function(err) { console.error(err); process.exit(1); });
