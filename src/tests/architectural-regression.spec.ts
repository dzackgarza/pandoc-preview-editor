import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killServer, launchServer, type ServerInstance } from './helpers.js';

function createWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'pandoc-regression-'));
  const file = join(dir, 'source.md');
  writeFileSync(file, '# Test Source\n\nInitial.', 'utf-8');
  return { dir, file };
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

test.describe('Architectural Slop Regression Tests', () => {
  test('injectBaseTag correctly leaves comments and scripts untouched and injects base tag', async () => {
    const { dir, file } = createWorkspace();
    let server: ServerInstance | undefined;

    try {
      server = await launchServer(undefined, file);

      // Post markdown containing:
      // 1. A normal image
      // 2. An HTML comment containing a mock src attribute (should NOT be rewritten)
      // 3. A <script> block with a src variable string (should NOT be rewritten)
      const markdown = [
        '![](figure.png)',
        '',
        '<!-- <img src="comment.png"> -->',
        '',
        '<script>const src="script.png";</script>',
      ].join('\n');

      const res = await fetch(`${server.url}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; html: string };
      expect(data.ok).toBe(true);

      // Base tag MUST be injected
      expect(data.html).toContain('/api/preview-assets/');
      expect(data.html).toContain('<base href="http');

      // The image src attribute remains relative and untouched
      expect(data.html).toContain('src="figure.png"');

      // HTML comments and scripts SHOULD NOT be rewritten
      expect(data.html).toContain('<!-- <img src="comment.png"> -->');
      expect(data.html).toContain('<script>const src="script.png";</script>');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('injectBaseTag injects base href and preserves all relative and absolute src paths', async () => {
    const { dir, file } = createWorkspace();
    let server: ServerInstance | undefined;

    try {
      server = await launchServer(undefined, file);

      // Markdown containing raw HTML with various src patterns
      const markdown = [
        // Relative path
        '<img src="figure.png">',
        // Subdirectory relative
        '<img src="assets/img/diagram.svg">',
        // Absolute URL
        '<img src="https://example.com/image.png">',
        // Root-relative
        '<img src="/static/image.png">',
        // Anchor
        '<img src="#section">',
        // Data URI
        '<img src="data:image/png;base64,iVBORw0KGgo=">',
        // Protocol-relative URL
        '<img src="//cdn.example.com/image.png">',
        // Comment with src looking like an image
        '<!-- <img src="comment.png"> -->',
        // Script tag with src assignment
        '<script>const src="script.png";</script>',
        // Multi-line src attribute
        '<span\n  class="math inline"\n  src="multiline.png">x</span>',
        // Image inside a figure with multiple attributes
        '<figure><img src="photo.jpg" alt="A photo" width="400"/></figure>',
        // Multiple images
        '<img src="first.png"><img src="second.png">',
        // src with single quotes
        "<img src='local.png'>",
        // Empty src
        '<img src="">',
      ].join('\n\n');

      const res = await fetch(`${server.url}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; html: string };
      expect(data.ok).toBe(true);

      const html = data.html;

      // Base tag MUST be injected
      expect(html).toContain('/api/preview-assets/');
      expect(html).toContain('<base href="http');

      // All paths SHOULD remain completely unmodified and preserved exactly as original
      expect(html).toContain('src="multiline.png"');
      expect(html).toContain('src="figure.png"');
      expect(html).toContain('src="assets/img/diagram.svg"');
      expect(html).toContain('src="photo.jpg"');
      expect(html).toContain('src="first.png"');
      expect(html).toContain('src="second.png"');
      expect(html).toContain("src='local.png'");

      // Protocol URLs, anchor, data, comments, empty
      expect(html).toContain('src="https://example.com/image.png"');
      expect(html).toContain('src="//cdn.example.com/image.png"');
      expect(html).toContain('src="/static/image.png"');
      expect(html).toContain('src="#section"');
      expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
      expect(html).toContain('<!-- <img src="comment.png"> -->');
      expect(html).toContain('<script>const src="script.png";</script>');
      expect(html).toContain('src=""');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('quick-open spawn API executes custom launcher pipeline and loads selected file', async () => {
    const { dir, file } = createWorkspace();
    const nestedFile = join(dir, 'chapter.md');
    writeFileSync(nestedFile, '# Chapter Content', 'utf-8');

    // Create custom test config specifying our mock quick-open command
    const testConfigPath = join(dir, 'test-config.toml');
    writeFileSync(
      testConfigPath,
      `[pandoc]
render_command = "pandoc"

[quick_open]
launcher_command = "echo chapter.md"
`,
      'utf-8',
    );

    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, file, testConfigPath);

      const res = await fetch(`${server.url}/api/files/quick-open-spawn`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        path: string;
        absolutePath: string;
        content: string;
      };

      expect(data.ok).toBe(true);
      expect(data.path).toBe('chapter.md');
      expect(data.content).toBe('# Chapter Content');
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });

  test('quick-open spawn API returns cancelled state on launcher exit code 130 or 1', async () => {
    const { dir, file } = createWorkspace();

    const testConfigPath = join(dir, 'test-config.toml');
    writeFileSync(
      testConfigPath,
      `[pandoc]
render_command = "pandoc"

[quick_open]
launcher_command = "exit 130"
`,
      'utf-8',
    );

    let server: ServerInstance | undefined;
    try {
      server = await launchServer(undefined, file, testConfigPath);

      const res = await fetch(`${server.url}/api/files/quick-open-spawn`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        cancelled: boolean;
      };

      expect(data.ok).toBe(false);
      expect(data.cancelled).toBe(true);
    } finally {
      if (server) await killServer(server);
      cleanup(dir);
    }
  });
});
