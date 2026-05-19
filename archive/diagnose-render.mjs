import { chromium } from 'playwright';

async function main() {
  var browser = await chromium.launch({ headless: true });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  var issues = [];

  page.on('console', function(msg) {
    var t = msg.type();
    if (t === 'error' || t === 'warning') {
      console.log('[' + t + ']', msg.text());
    }
  });
  page.on('pageerror', function(err) {
    console.log('[PAGE_ERROR]', err.message);
  });

  await page.goto('http://localhost:3141');
  await page.waitForSelector('.xterm', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // === CHECK 1: What does nvim think its dimensions are? ===
  var nvimDims = await page.evaluate(function() {
    var rowsEl = document.querySelector('.xterm-rows');
    // xterm.js exposes the terminal dimensions via element attributes
    var xtermEl = document.querySelector('.xterm');
    var screenEl = document.querySelector('.xterm-screen');

    // Get the number of visible character rows by counting text rows in the buffer
    var text = rowsEl ? rowsEl.textContent || '' : '';
    var lines = text.split('\n');

    // Check the screen dimensions
    var screenH = screenEl ? screenEl.getBoundingClientRect().height : 0;
    var xtermH = xtermEl ? xtermEl.getBoundingClientRect().height : 0;

    // Check what the CSS font-size actually resolved to
    var fontSize = xtermEl ? parseFloat(getComputedStyle(xtermEl).fontSize) : 0;

    // Check if xterm has a character measure element for calculating dimensions
    var charMeasure = document.querySelector('.xterm-char-measure-element');
    var charW = 0, charH = 0;
    if (charMeasure) {
      var cr = charMeasure.getBoundingClientRect();
      charW = cr.width;
      charH = cr.height;
    }

    return {
      viewportH: xtermH,
      screenH: screenH,
      visibleLines: lines.length,
      fontSize: fontSize,
      charWidth: charW,
      charHeight: charH,
      // Estimate nvim's visible dimensions
      estimatedRows: screenH > 0 && charH > 0 ? Math.round(screenH / charH) : 0,
      estimatedCols: xtermEl && charW > 0 ? Math.round(xtermEl.getBoundingClientRect().width / charW) : 0,
    };
  });
  console.log('\n=== NVIM DIMENSIONS (as xterm.js sees them) ===');
  console.log(JSON.stringify(nvimDims, null, 2));

  if (nvimDims.estimatedRows < 20 || nvimDims.estimatedRows > 60) {
    issues.push('Suspicious row count: ' + nvimDims.estimatedRows);
  }

  // === CHECK 2: Send a resize event and see if nvim responds correctly ===
  console.log('\n=== RESIZE CHECK: Resize window and measure ===');
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(2000);

  var afterResize = await page.evaluate(function() {
    var text = document.querySelector('.xterm-rows') ? document.querySelector('.xterm-rows').textContent || '' : '';
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      lines: text.split('\n').length,
      hasNormal: text.includes('NORMAL'),
      hasInsert: text.includes('INSERT'),
    };
  });
  console.log('After 800x600:', JSON.stringify(afterResize, null, 2));

  // === CHECK 3: Refresh and check state ===
  console.log('\n=== REFRESH CHECK ===');
  var textBefore = await page.evaluate(function() {
    return document.querySelector('.xterm-rows') ? document.querySelector('.xterm-rows').textContent || '' : '';
  });
  var hashBefore = textBefore.length;

  await page.reload();
  await page.waitForSelector('.xterm', { timeout: 15000 });
  await page.waitForTimeout(3000);

  var textAfter = await page.evaluate(function() {
    return document.querySelector('.xterm-rows') ? document.querySelector('.xterm-rows').textContent || '' : '';
  });
  var overlap = 0;
  var linesBefore = textBefore.split('\n').slice(-5);
  var linesAfter = textAfter.split('\n').slice(-5);
  for (var bi = 0; bi < linesBefore.length; bi++) {
    for (var ai = 0; ai < linesAfter.length; ai++) {
      if (linesBefore[bi].trim() && linesBefore[bi].trim() === linesAfter[ai].trim()) {
        overlap++;
      }
    }
  }
  // On a fresh page load with WS reconnect, the status line should be the same
  // (it's from nvim's fresh UI render), but the CONTENT should be fresh
  console.log('Text length before:', hashBefore, 'after:', textAfter.length);
  console.log('Last 5 lines overlap:', overlap + ' (0-5 expected, 5 means total state persistence)');

  if (overlap >= 5) {
    issues.push('State appears to fully persist across refresh');
  }

  // === CHECK 4: Type in insert mode and check for corruption ===
  console.log('\n=== INSERT MODE TYPING CHECK ===');
  await page.keyboard.press('i');
  await page.waitForTimeout(500);
  await page.keyboard.type('test typing with some longer text here to see if corruption occurs ', { delay: 20 });
  await page.waitForTimeout(1000);

  var textAfterType = await page.evaluate(function() {
    return document.querySelector('.xterm-rows') ? document.querySelector('.xterm-rows').textContent || '' : '';
  });
  // Check how many lines have text from the status line
  var corruptedLines = [];
  var allLines = textAfterType.split('\n');
  for (var li = 0; li < allLines.length; li++) {
    var line = allLines[li].trim();
    // Status line text appearing mid-screen is corruption
    if (line.includes('INSERT') && li < allLines.length - 3) {
      corruptedLines.push('status line at line ' + li + ': ' + line);
    }
    if (line.includes('NORMAL') && li < allLines.length - 3) {
      corruptedLines.push('status line at line ' + li + ': ' + line);
    }
  }

  if (corruptedLines.length > 0) {
    console.log('Corruption detected:');
    corruptedLines.forEach(function(cl) { console.log('  ' + cl); });
    issues.push('Status line appears mid-screen: ' + corruptedLines.length + ' occurrences');
  } else {
    console.log('No mid-screen status line corruption detected');
  }

  // === REPORT ===
  console.log('\n' + '='.repeat(50));
  console.log('ISSUES FOUND: ' + issues.length);
  issues.forEach(function(issue, i) { console.log('  ' + (i+1) + '. ' + issue); });
  if (issues.length === 0) console.log('None detected in headless mode');

  await page.screenshot({ path: '/tmp/pandoc-diagnostic.png' });
  console.log('Screenshot: /tmp/pandoc-diagnostic.png');
  await browser.close();
}

main().catch(function(err) { console.error(err); process.exit(1); });
