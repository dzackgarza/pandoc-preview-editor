import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

async function main() {
  var testFile = '/tmp/pandoc-repro.md';
  writeFileSync(testFile, '# Repro Doc\n\nLine 1\nLine 2\nLine 3\n');

  // The server should already be running on 3141 from our background process
  // Check if it's alive
  try {
    var r = await fetch('http://localhost:3141/api/status');
    var status = await r.json();
    console.log('Server status:', JSON.stringify(status));
  } catch(e) {
    console.log('Server not running, starting...');
    process.exit(1);
  }

  var browser = await chromium.launch({ headless: true });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Watch console
  var errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      errors.push(msg.type() + ': ' + msg.text());
    }
  });
  page.on('pageerror', err => { errors.push('PAGE_ERROR: ' + err.message); });

  await page.goto('http://localhost:3141');
  await page.waitForSelector('.xterm', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Get full terminal state
  var initial = await page.evaluate(function() {
    return {
      rows: document.querySelectorAll('.xterm-rows').length,
      text: document.querySelector('.xterm-rows') ? document.querySelector('.xterm-rows').textContent || '' : '',
      canvas: document.querySelectorAll('.xterm-screen canvas').length,
      viewportH: document.querySelector('.xterm-viewport') ? document.querySelector('.xterm-viewport').getBoundingClientRect().height : 0,
    };
  });
  console.log('\n=== INITIAL STATE ===');
  console.log('Rows elements:', initial.rows);
  console.log('Canvas elements:', initial.canvas);
  console.log('Viewport height:', initial.viewportH);
  console.log('Text preview (last 400):', initial.text.slice(-400));

  // Navigate around, type, check for corruption
  await page.keyboard.press('j');
  await page.waitForTimeout(200);
  await page.keyboard.press('j');
  await page.waitForTimeout(200);
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  await page.keyboard.type('inserted text here ', { delay: 30 });

  // Wait for any corruption to appear
  await page.waitForTimeout(1000);

  var afterType = await page.evaluate(function() {
    return {
      text: document.querySelector('.xterm-rows') ? document.querySelector('.xterm-rows').textContent || '' : '',
      lines: document.querySelector('.xterm-rows') ? (document.querySelector('.xterm-rows').textContent || '').split('\n').length : 0,
    };
  });
  console.log('\n=== AFTER TYPING ===');
  console.log('Lines:', afterType.lines);
  console.log('Text (last 500):', afterType.text.slice(-500));

  // Check for corruption patterns
  var text = afterType.text;
  var issues = [];

  // Multiple status lines
  var statusCount = (text.match(/INSERT|NORMAL|VISUAL/g) || []).length;
  if (statusCount > 3) issues.push('Status line appears ' + statusCount + ' times');

  // Extra blank lines inserted by the server
  var consecutiveBlanks = text.split('\n\n\n\n');
  if (consecutiveBlanks.length > 5) issues.push('Lots of blank lines: ' + consecutiveBlanks.length + ' sections of 4+ newlines');

  // Read-only complaint
  if (text.toLowerCase().includes('readonly') || text.toLowerCase().includes('read only')) {
    issues.push('Read-only warning present');
  }

  // Escape leaks
  if (text.includes('[38;2;') || text.includes('[48;2;') || text.includes('38;2;')) {
    issues.push('Escape sequence leak');
  }

  // Refresh test
  console.log('\n=== REFRESH TEST ===');
  await page.reload();
  await page.waitForSelector('.xterm', { timeout: 15000 });
  await page.waitForTimeout(3000);

  var afterReload = await page.evaluate(function() {
    return {
      text: document.querySelector('.xterm-rows') ? document.querySelector('.xterm-rows').textContent || '' : '',
      lines: document.querySelector('.xterm-rows') ? (document.querySelector('.xterm-rows').textContent || '').split('\n').length : 0,
    };
  });
  console.log('After reload lines:', afterReload.lines);
  console.log('After reload text (last 400):', afterReload.text.slice(-400));

  if (afterReload.text.includes('inserted text here')) {
    issues.push('State leaked across page refresh');
  }

  // Take screenshot
  await page.screenshot({ path: '/tmp/pandoc-repro-result.png' });
  console.log('\nScreenshot: /tmp/pandoc-repro-result.png');

  console.log('\n=== ISSUES FOUND: ' + issues.length + ' ===');
  issues.forEach(function(issue, i) { console.log('  ' + (i+1) + '. ' + issue); });
  if (issues.length === 0) console.log('  None detected');

  console.log('\nErrors from console:');
  errors.slice(0, 10).forEach(function(e) { console.log('  ' + e); });

  await browser.close();
}

main().catch(function(err) { console.error(err); process.exit(1); });
