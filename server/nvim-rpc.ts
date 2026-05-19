import { execFile } from 'node:child_process';
import { attach, type NeovimClient } from 'neovim';
import { ATTACH } from 'neovim/lib/api/Buffer.js';
import { existsSync } from 'node:fs';

let nvimClient: NeovimClient | null = null;

// Connect to nvim via RPC socket and return the client
export async function connectNvim(socketPath: string): Promise<NeovimClient> {
  if (nvimClient) {
    return nvimClient;
  }

  // Wait for socket to exist
  for (let i = 0; i < 20; i++) {
    if (existsSync(socketPath)) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!existsSync(socketPath)) {
    throw new Error(`Socket ${socketPath} does not exist after waiting`);
  }

  console.log(`[nvim-rpc] Connecting to socket: ${socketPath}`);

  // Attach neovim client directly to socket path (neovim package handles connection)
  nvimClient = attach({ socket: socketPath });

  // Verify connection with API call
  try {
    await nvimClient.apiInfo;
    console.log('[nvim-rpc] Connected to nvim via RPC socket');
  } catch (err: any) {
    nvimClient = null;
    throw new Error(`Failed to verify nvim connection: ${err.message}`);
  }

  return nvimClient;
}

// Attach to buffer and call callback on changes
export async function attachBuffer(
  client: NeovimClient,
  callback: (content: string) => void,
): Promise<void> {
  const buffers = await client.buffers;
  if (buffers.length === 0) {
    throw new Error('No buffers available');
  }

  // Get the first buffer (main editing buffer)
  const buffer = buffers[0];

  // Attach to buffer and listen for changes using the ATTACH symbol
  const attached = await buffer[ATTACH](true, {});
  if (!attached) {
    throw new Error('Failed to attach to buffer');
  }

  console.log('[nvim-rpc] Attached to buffer with nvim_buf_attach()');

  // Listen for buffer change notifications
  client.on('notification', async (method: string, args: any[]) => {
    if (method === 'nvim_buf_lines_event') {
      try {
        // Get full buffer content on any change
        const lines = await buffer.lines;
        const content = lines.join('\n');
        callback(content);
      } catch (err: any) {
        console.error('[nvim-rpc] Error reading buffer after change:', err.message);
      }
    }
  });

  // Send initial content
  const lines = await buffer.lines;
  const initialContent = lines.join('\n');
  callback(initialContent);
}

// Legacy execFile-based functions for compatibility (used by tests)
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
          reject(new Error(`nvim--remote-send failed: ${stderr || err.message}`));
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
