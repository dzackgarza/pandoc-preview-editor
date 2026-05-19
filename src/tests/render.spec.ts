import { test, expect } from '@playwright/test';
import {
  launchServer,
  killServer,
  pandocRender,
  type ServerInstance,
} from './helpers.js';

// ============================================================
// Layer 3-style: raw pandoc render, no server needed
// ============================================================

test('renders markdown heading', () => {
  const md = '# The Title\n\nSome text.';
  const result = pandocRender(md);

  expect(result.status, `pandoc exit 0; stderr=${result.stderr}`).toBe(0);
  expect(result.stdout).toContain('The Title');
});

test('renders math as span.math', () => {
  const md = '$E=mc^2$';
  const result = pandocRender(md);

  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/<span class="math inline">/);
});

test('renders bold and italic', () => {
  const md = '**bold** and *italic*';
  const result = pandocRender(md);

  expect(result.stdout).toContain('<strong>bold</strong>');
  expect(result.stdout).toContain('<em>italic</em>');
});

test('renders code blocks', () => {
  const md = '```python\nprint("hello")\n```';
  const result = pandocRender(md);

  expect(result.stdout).toMatch(/<code[\s>]/);
  expect(result.stdout).toContain('print');
});

test('renders tables', () => {
  const md = '| A | B |\n|---|---|\n| 1 | 2 |';
  const result = pandocRender(md);

  expect(result.stdout).toMatch(/<table/);
  expect(result.stdout).toContain('1');
});

test('renders lists', () => {
  const md = '- item one\n- item two';
  const result = pandocRender(md);

  expect(result.stdout).toMatch(/<ul>/);
  expect(result.stdout).toContain('item one');
});

// ============================================================
// API render tests: need running server
// ============================================================

let server: ServerInstance;

test.describe('/api/render', () => {
  test.beforeAll(async () => {
    server = await launchServer();
  });

  test.afterAll(async () => {
    if (server) await killServer(server);
  });

  test('POST /api/render returns HTML for markdown', async () => {
    const res = await fetch(`${server.url}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '# Hello\n\nWorld.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.html).toContain('Hello');
    expect(data.html).toContain('World');
    expect(typeof data.durationMs).toBe('number');
  });

  test('POST /api/render returns 400 when markdown field missing', async () => {
    const res = await fetch(`${server.url}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/render handles empty string', async () => {
    const res = await fetch(`${server.url}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.html).toBe('string');
  });

  test('POST /api/render renders math', async () => {
    const res = await fetch(`${server.url}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: 'Math: $\\alpha^2 + \\beta^2$' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.html).toMatch(/<span class="math inline">/);
  });
});
