import { test, expect } from '@playwright/test';
import { launchServer, killServer, type ServerInstance } from './helpers.js';

let server: ServerInstance;

test.describe('/api/render', () => {
  test.beforeAll(async () => {
    server = await launchServer();
  });

  test.afterAll(async () => {
    if (server) await killServer(server);
  });

  async function apiRender(markdown: string) {
    const res = await fetch(`${server.url}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    return {
      res,
      data: (await res.json()) as { ok: boolean; html: string; durationMs: number },
    };
  }

  test('renders markdown heading', async () => {
    const { res, data } = await apiRender('# The Title\n\nSome text.');
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.html).toContain('The Title');
  });

  test('renders math as span.math', async () => {
    const { res, data } = await apiRender('$E=mc^2$');
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.html).toMatch(/<span class="math inline">/);
  });

  test('renders bold and italic', async () => {
    const { data } = await apiRender('**bold** and *italic*');
    expect(data.html).toContain('<strong>bold</strong>');
    expect(data.html).toContain('<em>italic</em>');
  });

  test('renders code blocks', async () => {
    const { data } = await apiRender('```python\nprint("hello")\n```');
    expect(data.html).toMatch(/<code[\s>]/);
    expect(data.html).toContain('print');
  });

  test('renders tables', async () => {
    const { data } = await apiRender('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(data.html).toMatch(/<table/);
    expect(data.html).toContain('1');
  });

  test('renders lists', async () => {
    const { data } = await apiRender('- item one\n- item two');
    expect(data.html).toMatch(/<ul>/);
    expect(data.html).toContain('item one');
  });

  test('POST /api/render returns HTML for markdown', async () => {
    const { res, data } = await apiRender('# Hello\n\nWorld.');
    expect(res.status).toBe(200);
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
    const { res, data } = await apiRender('');
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(typeof data.html).toBe('string');
  });

  test('POST /api/render renders math with LaTeX', async () => {
    const { data } = await apiRender('Math: $\\alpha^2 + \\beta^2$');
    expect(data.html).toMatch(/<span class="math inline">/);
  });
});
