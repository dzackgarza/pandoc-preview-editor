import { spawn } from 'node:child_process';

export interface RenderResult {
  html: string;
  durationMs: number;
  ok: boolean;
  stderr: string;
}

export function renderMarkdown(
  markdown: string,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<RenderResult> {
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      const message = `pandoc timed out after ${timeoutMs}ms`;
      resolve(renderError(message, startedAt));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(renderError(err.message, startedAt));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const stderrText = Buffer.concat(stderr).toString('utf-8');
      if (code !== 0) {
        resolve(
          renderError(stderrText || `pandoc exited with status ${code}`, startedAt),
        );
        return;
      }

      resolve({
        html: Buffer.concat(stdout).toString('utf-8'),
        durationMs: Math.round(performance.now() - startedAt),
        ok: true,
        stderr: stderrText,
      });
    });

    child.stdin.end(markdown);
  });
}

function renderError(message: string, startedAt: number): RenderResult {
  return {
    html: `<!-- pandoc error:\n${message}\n-->`,
    durationMs: Math.round(performance.now() - startedAt),
    ok: false,
    stderr: message,
  };
}
