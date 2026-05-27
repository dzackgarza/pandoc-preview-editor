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
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RenderResult> {
  const startedAt = performance.now();

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(renderError('Render cancelled', startedAt));
      return;
    }

    // POSIX sh does not expand `~` after `=` (e.g. --lua-filter=~/.pandoc/...).
    // Normalize `~/` → `$HOME/` so the shell handles expansion in all positions.
    const shellCommand = command.replace(/(^|\s|=)~\//g, '$1$HOME/');
    const child = spawn(shellCommand, [], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      const message = `renderer timed out after ${timeoutMs}ms`;
      resolve(renderError(message, startedAt));
    }, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill('SIGTERM');
      resolve(renderError('Render cancelled', startedAt));
    };

    signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      resolve(renderError(err.message, startedAt));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);

      const stderrText = Buffer.concat(stderr).toString('utf-8');
      if (code !== 0) {
        resolve(
          renderError(stderrText || `renderer exited with status ${code}`, startedAt),
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

    // Suppress EPIPE: if the child is killed while stdin is still draining,
    // the broken pipe would otherwise become an unhandled stream error and
    // crash the Express process.
    child.stdin.on('error', () => {});
    child.stdin.end(markdown);
  });
}

function renderError(message: string, startedAt: number): RenderResult {
  return {
    html: `<!-- renderer error:\n${message}\n-->`,
    durationMs: Math.round(performance.now() - startedAt),
    ok: false,
    stderr: message,
  };
}
