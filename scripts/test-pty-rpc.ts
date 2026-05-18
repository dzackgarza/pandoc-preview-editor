import { spawnNvim } from '../server/pty.js';
import { getBuffer, pollReady } from '../server/nvim-rpc.js';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const RUN_DIR = join(tmpdir(), 'pandoc-nvim-preview');
const SOCK = join(RUN_DIR, 'nvim.sock');

if (!existsSync(RUN_DIR)) mkdirSync(RUN_DIR, { recursive: true });
if (existsSync(SOCK)) rmSync(SOCK);

async function main() {
  const nvim = spawnNvim('/tmp/test-pty-doc.md', SOCK);
  console.log('PTY PID:', nvim.pid);

  const ready = await pollReady(SOCK);
  console.log('Ready:', ready);
  if (!ready) {
    nvim.kill();
    throw new Error('nvim not ready');
  }

  const buf = await getBuffer(SOCK);
  console.log('Buffer:');
  console.log(buf);

  nvim.kill();
  rmSync(SOCK);
  console.log('PASS: remote-expr works against PTY-spawned nvim');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
