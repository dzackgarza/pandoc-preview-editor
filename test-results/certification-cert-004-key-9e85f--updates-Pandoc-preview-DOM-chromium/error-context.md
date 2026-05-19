# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: certification.spec.ts >> cert_004 keyboard input updates Pandoc preview DOM
- Location: tests/certification.spec.ts:282:1

# Error details

```
Error: Command failed: nvim --server /tmp/pandoc-nvim-preview/nvim.sock --remote-send :%d<CR>
E247: Failed to connect to '/tmp/pandoc-nvim-preview/nvim.sock': connection refused. Send failed.

```

# Test source

```ts
  4   |   execFileSync,
  5   |   spawnSync,
  6   | } from 'node:child_process';
  7   | import { writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
  8   | import { join } from 'node:path';
  9   | import { tmpdir } from 'node:os';
  10  | 
  11  | const PORT = 3141;
  12  | 
  13  | export function seedTempFile(slug: string, content: string): string {
  14  |   const dir = mkdtempSync(join(tmpdir(), `pnp-${slug}-`));
  15  |   const path = join(dir, 'doc.md');
  16  |   writeFileSync(path, content, 'utf-8');
  17  |   return path;
  18  | }
  19  | 
  20  | export function readFile(path: string): string {
  21  |   return readFileSync(path, 'utf-8');
  22  | }
  23  | 
  24  | export function fileExists(path: string): boolean {
  25  |   return existsSync(path);
  26  | }
  27  | 
  28  | export interface ServerInstance {
  29  |   port: number;
  30  |   process: ChildProcess;
  31  |   filePath: string;
  32  |   url: string;
  33  |   socketPath: string;
  34  |   nvimPid: number;
  35  |   out: string[];
  36  |   err: string[];
  37  | }
  38  | 
  39  | export async function launchServer(filePath: string): Promise<ServerInstance> {
  40  |   const out: string[] = [];
  41  |   const err: string[] = [];
  42  | 
  43  |   const proc = spawn(
  44  |     'npx',
  45  |     ['tsx', 'server/cli.ts', filePath, '--no-open'],
  46  |     {
  47  |       cwd: join(import.meta.dirname, '..'),
  48  |       env: { ...process.env, NO_OPEN: '1' },
  49  |       stdio: 'pipe',
  50  |     },
  51  |   );
  52  | 
  53  |   proc.stdout?.on('data', (d: Buffer) => out.push(d.toString()));
  54  |   proc.stderr?.on('data', (d: Buffer) => err.push(d.toString()));
  55  | 
  56  |   const url = `http://localhost:${PORT}`;
  57  |   await waitForServer(url, 15000);
  58  | 
  59  |   // Fetch the socket path and nvim PID from the server status endpoint
  60  |   const statusRes = await fetch(`${url}/api/status`);
  61  |   if (!statusRes.ok) {
  62  |     throw new Error(`Failed to get server status: ${statusRes.status} ${statusRes.statusText}`);
  63  |   }
  64  |   const status = (await statusRes.json()) as { pid: number; socket: string };
  65  |   if (!status.socket) {
  66  |     throw new Error('Server status response missing socket path');
  67  |   }
  68  | 
  69  |   return {
  70  |     port: PORT,
  71  |     process: proc,
  72  |     filePath,
  73  |     url,
  74  |     socketPath: status.socket,
  75  |     nvimPid: status.pid,
  76  |     out,
  77  |     err,
  78  |   };
  79  | }
  80  | 
  81  | async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  82  |   const start = Date.now();
  83  |   while (Date.now() - start < timeoutMs) {
  84  |     try {
  85  |       const res = await fetch(`${url}/api/status`);
  86  |       if (res.ok) return;
  87  |     } catch {
  88  |       // server not listening yet
  89  |     }
  90  |     await new Promise((r) => setTimeout(r, 200));
  91  |   }
  92  |   throw new Error(`Server at ${url} not ready within ${timeoutMs}ms`);
  93  | }
  94  | 
  95  | export function nvimDirectRPC(socketPath: string, expr: string): string {
  96  |   const stdout = execFileSync('nvim', ['--server', socketPath, '--remote-expr', expr], {
  97  |     encoding: 'utf-8',
  98  |     timeout: 5000,
  99  |   });
  100 |   return stdout.trim();
  101 | }
  102 | 
  103 | export function nvimDirectSend(socketPath: string, keys: string): void {
> 104 |   execFileSync('nvim', ['--server', socketPath, '--remote-send', keys], {
      |   ^ Error: Command failed: nvim --server /tmp/pandoc-nvim-preview/nvim.sock --remote-send :%d<CR>
  105 |     timeout: 5000,
  106 |   });
  107 | }
  108 | 
  109 | export function nvimDirectQuit(socketPath: string): void {
  110 |   try {
  111 |     execFileSync('nvim', ['--server', socketPath, '--remote-send', ':qa!<CR>'], {
  112 |       timeout: 3000,
  113 |     });
  114 |   } catch {
  115 |     // already gone
  116 |   }
  117 | }
  118 | 
  119 | export interface PandocResult {
  120 |   stdout: string;
  121 |   stderr: string;
  122 |   status: number | null;
  123 |   argv: string[];
  124 | }
  125 | 
  126 | export function pandocRender(markdown: string): PandocResult {
  127 |   const args = [
  128 |     '-f',
  129 |     'markdown+tex_math_dollars+citations',
  130 |     '-t',
  131 |     'html',
  132 |     '--standalone',
  133 |     '--mathjax',
  134 |     '--citeproc',
  135 |   ];
  136 | 
  137 |   const result = spawnSync('pandoc', args, {
  138 |     input: markdown,
  139 |     encoding: 'utf-8',
  140 |     timeout: 5000,
  141 |     maxBuffer: 10 * 1024 * 1024,
  142 |   });
  143 | 
  144 |   return {
  145 |     stdout: result.stdout?.trim() || '',
  146 |     stderr: (result.stderr || '').trim(),
  147 |     status: result.status ?? null,
  148 |     argv: ['pandoc', ...args],
  149 |   };
  150 | }
  151 | 
  152 | export async function killServer(instance: ServerInstance): Promise<void> {
  153 |   instance.process.kill('SIGTERM');
  154 |   await new Promise((r) => setTimeout(r, 500));
  155 |   try {
  156 |     instance.process.kill('SIGKILL');
  157 |   } catch {
  158 |     // already exited
  159 |   }
  160 | }
  161 | 
```