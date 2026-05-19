/**
 * Unit test: does xterm.js handle fragmented true-color escape sequences?
 *
 * If true-color SGR sequences like \x1b[38;2;R;G;Bmtext are split across
 * two term.write() calls, does xterm.js render the escape sequence as
 * literal text?
 *
 * This tests the core hypothesis without the WebSocket/PTY layer.
 */
import { Terminal } from '@xterm/xterm';

function testFragmentedEscape(): string {
  const term = new Terminal({
    cols: 80,
    rows: 24,
    allowProposedApi: true,
  });

  // Use a headless DOM-like environment
  // xterm.js's Terminal works without a DOM for write operations
  // since the parser is in the core layer

  // Write first fragment (just CSI starter)
  term.write('\x1b[');

  // Write second fragment (rest of true-color sequence + text)
  term.write('38;2;147;153;179mFRAGTEST');

  // Write reset
  term.write('\x1b[0m\n');

  // Read the buffer to check for leaks
  const buf = term.buffer.active;
  let fullText = '';
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) {
      let lineText = '';
      for (let j = 0; j < line.length; j++) {
        const cell = line.getCell(j);
        if (cell) lineText += cell.getChars();
      }
      fullText += lineText + '\n';
    }
  }

  // Check if escape sequence literals appear in buffer content
  const results = {
    hasLiteral38: fullText.includes('38;2;'),
    hasBracket38: fullText.includes('[38;2;'),
    hasFRAGTEST: fullText.includes('FRAGTEST'),
    textPreview: fullText.slice(-400),
    // The text "FRAGTEST" should exist (it was written),
    // but "38;2;147;153;179m" should NOT appear literally
    leaked: fullText.includes('38;2;') || fullText.includes('[38;2;'),
  };

  return JSON.stringify(results, null, 2);
}

// Also test with non-fragmented (baseline)
function testNonFragmented(): string {
  const term = new Terminal({
    cols: 80,
    rows: 24,
    allowProposedApi: true,
  });

  // Written as one contiguous string (normal path)
  term.write('\x1b[38;2;147;153;179mFRAGTEST\x1b[0m\n');

  const buf = term.buffer.active;
  let fullText = '';
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) {
      let lineText = '';
      for (let j = 0; j < line.length; j++) {
        const cell = line.getCell(j);
        if (cell) lineText += cell.getChars();
      }
      fullText += lineText + '\n';
    }
  }

  const results = {
    hasLiteral38: fullText.includes('38;2;'),
    hasBracket38: fullText.includes('[38;2;'),
    hasFRAGTEST: fullText.includes('FRAGTEST'),
    textPreview: fullText.slice(-400),
    leaked: fullText.includes('38;2;') || fullText.includes('[38;2;'),
  };

  return JSON.stringify(results, null, 2);
}

console.log('=== NON-FRAGMENTED (baseline) ===');
console.log(testNonFragmented());

console.log('\n=== FRAGMENTED (split across two writes) ===');
console.log(testFragmentedEscape());

// If both pass without leaking, xterm.js handles fragmentation correctly.
// If FRAGMENTED leaks (RED), that's the mechanism for the bug.
