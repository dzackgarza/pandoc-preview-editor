import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function main() {
  // Setup
  var tmpDir = mkdtempSync(join(tmpdir(), 'esc-leak-'));
  var file = join(tmpDir, 'doc.md');
  writeFileSync(file, '# Test\n');

  var port = await new Promise(function(resolve, reject) {
    var s = createServer();
    s.listen(0, function() { var p = s.address().port; s.close(); resolve(p); });
    s.on('error', reject);
  });

  var server = spawn('npx', ['tsx', 'server/cli.ts', file, '--port', String(port), '--no-open'], {
    cwd: '/home/dzack/gitclones/pandoc-preview',
    env: Object.assign({}, process.env, { NO_OPEN: '1' }),
    stdio: 'pipe',
  });

  await new Promise(function(resolve, reject) {
    var deadline = Date.now() + 20000;
    function check() {
      if (Date.now() > deadline) { reject(new Error('timeout')); return; }
      fetch('http://localhost:' + port + '/api/status')
        .then(function(r) { if (r.ok) resolve(); else setTimeout(check, 100); })
        .catch(function() { setTimeout(check, 100); });
    }
    check();
  });

  // Launch browser
  var browser = await chromium.launch({ headless: true });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto('http://localhost:' + port);
  await page.waitForSelector('.xterm', { timeout: 10000 });
  await page.waitForTimeout(2000);

  // Test: send fragmented escape through the server's WS broadcast
  // The server broadcasts pty-output messages to ALL connected clients.
  // When we send a pty-output message from a second WS connection,
  // the server broadcasts it back to all clients including the app's page.
  // The app's onmessage handler then calls writeToTerminal with the data.
  // 
  // Critically: the server's broadcast uses JSON.stringify/parse round-trip.
  // If the \x1b byte survives the JSON round-trip, this tests the real path.
  var result = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var wsUrl = location.origin.replace(/^http/, 'ws');
      var done = false;

      var ws = new WebSocket(wsUrl);

      ws.onopen = function() {
        // Fragment 1: just the ESC + bracket (as if node-pty's onData split here)
        ws.send(JSON.stringify({ type: 'pty-output', data: '\x1b[' }));

        // Fragment 2: rest of SGR + text (arrives in a separate message, no \x1b)
        setTimeout(function() {
          ws.send(JSON.stringify({ type: 'pty-output', data: '38;2;147;153;179mFRAGTEST\n\x1b[0m' }));

          // Wait for render
          setTimeout(function() {
            ws.close();
            done = true;

            // Read ALL text from DOM
            var termContainer = document.querySelector('.xterm-rows');
            var text = termContainer ? termContainer.textContent || '' : '';

            resolve(JSON.stringify({
              has38: text.indexOf('38;2;') >= 0,
              hasBracket38: text.indexOf('[38;2;') >= 0,
              hasFRAGTEST: text.indexOf('FRAGTEST') >= 0,
              leaked: text.indexOf('38;2;') >= 0 || text.indexOf('[38;2;') >= 0,
              sample: text.slice(-500),
            }));
          }, 800);
        }, 200);

        setTimeout(function() {
          if (!done) { ws.close(); resolve(JSON.stringify({ error: 'TIMEOUT' })); }
        }, 8000);
      };
      ws.onerror = function() { if (!done) resolve(JSON.stringify({ error: 'WS_ERROR' })); };
    });
  });

  console.log('=== FRAGMENTED ESCAPE TEST ===');
  var data = JSON.parse(result);
  console.log(JSON.stringify(data, null, 2));

  // Cleanup
  await page.close();
  await browser.close();
  server.kill('SIGKILL');
  rmSync(tmpDir, { recursive: true });
}

main().catch(function(err) { console.error(err); process.exit(1); });
