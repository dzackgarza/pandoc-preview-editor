#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const mode = process.argv.includes('--staged') ? 'staged' : 'all';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function trackedFiles() {
  const output =
    mode === 'staged'
      ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
      : git(['ls-files']);
  return output === '' ? [] : output.split('\n');
}

function fileContent(path) {
  if (mode === 'staged') {
    return execFileSync('git', ['show', `:${path}`], { encoding: 'utf8' });
  }
  return readFileSync(path, 'utf8');
}

function hasLineMatching(content, pattern) {
  return content
    .split('\n')
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => {
      if (/^\s*(?:\/\/|\*)/.test(text)) return false;

      const match = text.match(pattern);
      if (!match) return false;

      const commentIndex = text.indexOf('//');
      return commentIndex === -1 || commentIndex > match.index;
    });
}

function isE2eTs(path) {
  return /^src\/tests\/e2e\/.*\.ts$/.test(path);
}

function isE2eSpec(path) {
  return /^src\/tests\/e2e\/.*\.spec\.ts$/.test(path);
}

function isTestTs(path) {
  return /^src\/tests\/.*\.ts$/.test(path);
}

function isShell(path) {
  return /\.(sh|bash|zsh)$/.test(path) || /^\.githooks\//.test(path);
}

function allowedMockFile(path) {
  return (
    path === 'src/tests/e2e/fixtures.ts' ||
    path === 'src/tests/playwright.config.ts' ||
    path === 'src/tests/e2e/app.spec.ts'
  );
}

// Documented exceptions from .agents/audits/banned-patterns-by-file.md
function isDocumentedException(path, line, text) {
  // app.spec.ts: browser-smoke test imports from @playwright/test
  if (path === 'src/tests/e2e/app.spec.ts') return true;
  // fixtures.ts: PageLike TS4023 workaround (line ~268)
  if (path === 'src/tests/e2e/fixtures.ts' && /as any/.test(text)) return true;
  // js-toml library load() returns unknown — narrow cast is documented
  if (/load\([^)]+\) as any/.test(text)) return true;
  // Tauri IPC pandoc_assets response is untyped — narrow cast
  if (/assets as any/.test(text)) return true;
  return false;
}

const rules = [
  {
    name: 'type suppression is banned in test code',
    applies: isTestTs,
    pattern: /@ts-(?:nocheck|ignore)/,
  },
  {
    name: 'broad any escapes are banned in test code',
    applies: isTestTs,
    check: (path, line, text) => isDocumentedException(path, line, text),
    pattern: /\b(?:as|:)\s+any\b/,
  },
  {
    name: 'E2E specs must import the repo fixture, not generic Playwright',
    applies: (path) => isE2eSpec(path) && !isDocumentedException(path, null, null),
    check: (path, line, text) => isDocumentedException(path, line, text),
    pattern: /from\s+['"]@playwright\/test['"]/,
  },
  {
    name: 'focused tests are banned',
    applies: isTestTs,
    pattern: /\b(?:test|describe)\.only\s*\(/,
  },
  {
    name: 'skips and xfail-style markers are banned in proof tests',
    applies: isTestTs,
    check: (path, line, text) => isDocumentedException(path, line, text),
    pattern: /\b(?:test|describe)\.(?:skip|fixme|fail)\s*\(/,
  },
  {
    name: 'CJS require is banned in TypeScript test modules',
    applies: isTestTs,
    pattern: /\brequire\s*\(/,
  },
  {
    name: 'TauriPage does not expose frameLocator',
    applies: isE2eTs,
    pattern: /\.frameLocator\s*\(/,
  },
  {
    name: 'network route mocking is banned in feature proofs',
    applies: isE2eTs,
    pattern: /\.route\s*\(/,
  },
  {
    name: 'TauriPage.evaluate takes a JavaScript string, not a callback',
    applies: isE2eTs,
    pattern: /\.evaluate(?:<[^>]+>)?\s*\(\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/,
  },
  {
    name: 'browser-mode IPC mock helpers are not desktop proof evidence',
    applies: (path) => isE2eTs(path) && !allowedMockFile(path),
    pattern: /\b(?:ipcMocks|getCapturedInvokes|clearCapturedInvokes|emitMockEvent)\b/,
  },
  {
    name: 'stderr-suppressed synthetic fallbacks are banned',
    applies: isShell,
    pattern: /2>\s*\/dev\/null\s*\|\|\s*(?:echo|printf)\b/,
  },
];

const failures = [];

for (const path of trackedFiles()) {
  const activeRules = rules.filter((rule) => rule.applies(path));
  if (activeRules.length === 0) continue;

  const content = fileContent(path);
  for (const rule of activeRules) {
    for (const match of hasLineMatching(content, rule.pattern)) {
      if (rule.check && rule.check(path, match.line, match.text)) continue;
      failures.push(`${path}:${match.line}: ${rule.name}\n  ${match.text.trim()}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Agent contract gate failed:\n');
  console.error(failures.join('\n\n'));
  process.exit(1);
}
