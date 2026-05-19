import { chromium } from 'playwright';

async function main() {
  // Create minimal HTML that imports xterm.js from node_modules via the bundler
  var html = `<!DOCTYPE html><html><head>
  <style>body{margin:0;background:#000}#term{width:800px;height:300px}</style>
  <link rel="stylesheet" href="http://localhost:9999/xterm.css">
</head><body><div id="term"></div>
<script type="module">
import { Terminal } from 'http://localhost:9999/xterm.mjs';
import { FitAddon } from 'http://localhost:9999/fit.mjs';

window.runTest = function() {
  return new Promise(function(resolve) {
    var term = new Terminal({cols:80, rows:24});
    var fit = new FitAddon();
    term.loadAddon(fit);
    term.open(document.getElementById('term'));

    // Fragment 1: just ESC + bracket
    term.write('\\x1b[');

    // Fragment 2: rest of sequence
    setTimeout(function() {
      term.write('38;2;147;153;179mFRAGTEST\\x1b[0m\\n');

      setTimeout(function() {
        var buf = term.buffer.active;
        var text = '';
        for (var i = 0; i < buf.length; i++) {
          var line = buf.getLine(i);
          if (line) {
            for (var j = 0; j < line.length; j++) {
              var cell = line.getCell(j);
              if (cell) text += cell.getChars();
            }
            text += '\\n';
          }
        }
        resolve(JSON.stringify({
          text: text,
          has38: text.indexOf('38;2;') >= 0,
          hasFRAG: text.indexOf('FRAGTEST') >= 0,
          leaked: text.indexOf('38;2;') >= 0 || text.indexOf('[38;2;') >= 0,
        }));
      }, 200);
    }, 100);
  });
};
</script></body></html>`;

  // Start a simple static file server for xterm.js modules
  var http = await import('node:http');
  var fs = await import('node:fs');
  var path = await import('node:path');

  var serveDir = '/home/dzack/gitclones/pandoc-preview/node_modules/@xterm';
  var srv = http.createServer(function(req, res) {
    var filePath = path.join(serveDir, req.url);
    if (req.url === '/xterm.css') {
      res.end(fs.readFileSync(path.join(serveDir, 'xterm', 'css', 'xterm.css')));
    } else if (req.url === '/xterm.mjs') {
      res.end(fs.readFileSync(path.join(serveDir, 'xterm', 'lib', 'xterm.mjs')));
    } else if (req.url === '/fit.mjs') {
      res.end(fs.readFileSync(
        '/home/dzack/gitclones/pandoc-preview/node_modules/@xterm/addon-fit/lib/fit.mjs'));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  srv.listen(9999);

  var tmpFile = '/tmp/frag-test.html';
  fs.writeFileSync(tmpFile, html);

  var browser = await chromium.launch({ headless: true });
  var page = await browser.newPage();

  await page.goto('file://' + tmpFile);
  await page.waitForSelector('#term', { timeout: 10000 });
  await page.waitForTimeout(500);

  var result = await page.evaluate(function() { return window.runTest(); });
  var data = JSON.parse(result);

  console.log('=== XTERM DIRECT FRAGMENT TEST ===');
  console.log('Has 38;2;:', data.has38);
  console.log('Has FRAGTEST:', data.hasFRAG);
  console.log('Leaked:', data.leaked);
  console.log('Text:', JSON.stringify(data.text));

  if (data.leaked) {
    console.log('\n*** BUG CONFIRMED: fragmented escape leaks as literal text ***');
  } else {
    console.log('\nxterm.js handles fragment correctly (no leak)');
  }

  await browser.close();
  srv.close();
  fs.rmSync(tmpFile);
}

main().catch(function(err) { console.error(err); process.exit(1); });
