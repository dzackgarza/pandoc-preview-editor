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
  var proc = spawn('npx', ['tsx', 'server/cli.ts', file, '--port', '' + port, '--no-open'], {
    cwd: '/home/dzack/gitclones/pandoc-preview',
    env: Object.assign({}, process.env, { NO_OPEN: '1' }),
    stdio: 'pipe',
  });
  await waitForServer('http://localhost:' + port);

  // Run SAME test in headless AND headed, compare
  var modes = [
    { label: 'HEADLESS', headless: true },
    { label: 'HEADED', headless: false },
  ];

  for (var mi = 0; mi < modes.length; mi++) {
    var mode = modes[mi];
    console.log('\n========== ' + mode.label + ' ==========');

    var browser = await chromium.launch({ headless: mode.headless, args: ['--no-sandbox'] });
    var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    var net = [];
    page.on('response', function(r) { net.push(r.status() + ' ' + r.url().split('/').pop()); });

    await page.goto('http://localhost:' + port);
    await page.waitForSelector('#terminal-pane', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Dump ALL computed styles for every relevant element
    var dump = JSON.parse(await page.evaluate('(function() {' +
      'var ids = ["app","panes","toolbar","terminal-pane","preview-pane"];' +
      'var classes = [".xterm",".xterm-viewport",".xterm-screen",".xterm-rows"];' +
      'var els = {};' +
      'ids.forEach(function(id) { var e = document.getElementById(id); if (e) els["#" + id] = e; });' +
      'classes.forEach(function(cls) { var e = document.querySelector(cls); if (e) els[cls] = e; });' +
      'var result = {};' +
      'Object.keys(els).forEach(function(k) {' +
        'var e = els[k];' +
        'var b = e.getBoundingClientRect();' +
        'var cs = getComputedStyle(e);' +
        'result[k] = {' +
          'rect:{w:b.width,h:b.height},' +
          'style:{' +
            'display:cs.display,' +
            'height:cs.height,' +
            'minHeight:cs.minHeight,' +
            'maxHeight:cs.maxHeight,' +
            'padding:cs.padding,' +
            'paddingTop:cs.paddingTop,' +
            'paddingBottom:cs.paddingBottom,' +
            'flex:cs.flex,' +
            'flexGrow:cs.flexGrow,' +
            'flexShrink:cs.flexShrink,' +
            'overflow:cs.overflow,' +
            'position:cs.position' +
          '}' +
        '};' +
      '});' +
      'result._children = [];' +
      'var pane = document.getElementById("terminal-pane");' +
      'if (pane) {' +
        'for (var ci = 0; ci < pane.children.length; ci++) {' +
          'var c = pane.children[ci];' +
          'var cb = c.getBoundingClientRect();' +
          'result._children.push({tag:c.tagName, className:c.className, w:cb.width, h:cb.height, t:cb.top});' +
        '}' +
      '}' +
      'result._xtermChildren = [];' +
      'var xterm = document.querySelector(".xterm");' +
      'if (xterm) {' +
        'for (var ci = 0; ci < xterm.children.length; ci++) {' +
          'var c = xterm.children[ci];' +
          'var cb = c.getBoundingClientRect();' +
          'result._xtermChildren.push({tag:c.tagName, className:c.className, w:cb.width, h:cb.height, t:cb.top});' +
        '}' +
      '}' +
      'return JSON.stringify(result);' +
    '})()'));

    console.log(JSON.stringify(dump, null, 2));

    // Also dump xterm text content length
    var textLen = await page.evaluate('(function() { var r = document.querySelector(".xterm-rows"); return r ? r.textContent.length : -1; })()');
    console.log('xterm-rows text length:', textLen);

    console.log('Network requests:', net.join(', '));
    await browser.close();
  }

  proc.kill('SIGTERM');
  console.log('\nDone.');
}

main().catch(function(err) { console.error(err); process.exit(1); });
