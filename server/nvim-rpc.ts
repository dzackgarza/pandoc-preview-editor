import { execFile } from 'node:child_process';

export async function getBuffer(socketPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'nvim',
      ['--server', socketPath, '--remote-expr', 'join(getline(1, "$"), "\\n")'],
      { timeout: 3000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`nvim --remote-expr failed: ${stderr || err.message}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

export async function saveBuffer(socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'nvim',
      ['--server', socketPath, '--remote-send', ':w<CR>'],
      { timeout: 3000 },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`nvim --remote-send failed: ${stderr || err.message}`));
          return;
        }
        resolve();
      },
    );
  });
}

export async function pollReady(
  socketPath: string,
  maxAttempts = 20,
  delayMs = 250,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await getBuffer(socketPath);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}
