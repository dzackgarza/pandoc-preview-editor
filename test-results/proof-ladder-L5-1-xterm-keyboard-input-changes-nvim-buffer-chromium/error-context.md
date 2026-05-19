# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: proof-ladder.spec.ts >> L5.1 xterm_keyboard_input_changes_nvim_buffer
- Location: tests/proof-ladder.spec.ts:296:1

# Error details

```
Error: Command failed: nvim --server /tmp/pandoc-nvim-preview/nvim.sock --remote-expr join(getline(1, "$"), "\n")
E247: Failed to connect to '/tmp/pandoc-nvim-preview/nvim.sock': connection refused. Send expression failed.

```

# Test source

```ts
  3   |   ChildProcess,
  4   |   execFileSync,
  5   |   execSync,
  6   |   spawnSync,
  7   | } from 'node:child_process';
  8   | import { writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
  9   | import { join } from 'node:path';
  10  | import { tmpdir } from 'node:os';
  11  | import { createServer } from 'node:net';
  12  | 
  13  | export function getFreePort(): Promise<number> {
  14  |   return new Promise((resolve, reject) => {
  15  |     const server = createServer();
  16  |     server.listen(0, () => {
  17  |       const port = (server.address() as { port: number }).port;
  18  |       server.close(() => resolve(port));
  19  |     });
  20  |     server.on('error', reject);
  21  |   });
  22  | }
  23  | 
  24  | export function seedTempFile(slug: string, content: string): string {
  25  |   const dir = mkdtempSync(join(tmpdir(), `pnp-${slug}-`));
  26  |   const path = join(dir, 'doc.md');
  27  |   writeFileSync(path, content, 'utf-8');
  28  |   return path;
  29  | }
  30  | 
  31  | export function readFile(path: string): string {
  32  |   return readFileSync(path, 'utf-8');
  33  | }
  34  | 
  35  | export function fileExists(path: string): boolean {
  36  |   return existsSync(path);
  37  | }
  38  | 
  39  | export interface ServerInstance {
  40  |   port: number;
  41  |   process: ChildProcess;
  42  |   filePath: string;
  43  |   url: string;
  44  |   socketPath: string;
  45  |   nvimPid: number;
  46  |   out: string[];
  47  |   err: string[];
  48  | }
  49  | 
  50  | export async function launchServer(filePath: string): Promise<ServerInstance> {
  51  |   const port = await getFreePort();
  52  |   const out: string[] = [];
  53  |   const err: string[] = [];
  54  | 
  55  |   const proc = spawn(
  56  |     'npx',
  57  |     ['tsx', 'server/cli.ts', filePath, '--port', String(port), '--no-open'],
  58  |     {
  59  |       cwd: join(import.meta.dirname, '..'),
  60  |       env: { ...process.env, NO_OPEN: '1' },
  61  |       stdio: 'pipe',
  62  |     },
  63  |   );
  64  | 
  65  |   proc.stdout?.on('data', (d: Buffer) => out.push(d.toString()));
  66  |   proc.stderr?.on('data', (d: Buffer) => err.push(d.toString()));
  67  | 
  68  |   const url = `http://localhost:${port}`;
  69  |   await waitForServer(url, 15000);
  70  | 
  71  |   const socketPath = '/tmp/pandoc-nvim-preview/nvim.sock';
  72  | 
  73  |   // Fetch the nvim PID from the server status endpoint
  74  |   let nvimPid = 0;
  75  |   try {
  76  |     const statusRes = await fetch(`${url}/api/status`);
  77  |     if (statusRes.ok) {
  78  |       const status = (await statusRes.json()) as { pid: number };
  79  |       nvimPid = status.pid;
  80  |     }
  81  |   } catch {
  82  |     // non-critical; nvimPid stays 0
  83  |   }
  84  | 
  85  |   return { port, process: proc, filePath, url, socketPath, nvimPid, out, err };
  86  | }
  87  | 
  88  | async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  89  |   const start = Date.now();
  90  |   while (Date.now() - start < timeoutMs) {
  91  |     try {
  92  |       const res = await fetch(`${url}/api/status`);
  93  |       if (res.ok) return;
  94  |     } catch {
  95  |       // server not listening yet
  96  |     }
  97  |     await new Promise((r) => setTimeout(r, 200));
  98  |   }
  99  |   throw new Error(`Server at ${url} not ready within ${timeoutMs}ms`);
  100 | }
  101 | 
  102 | export function nvimDirectRPC(socketPath: string, expr: string): string {
> 103 |   const stdout = execFileSync('nvim', ['--server', socketPath, '--remote-expr', expr], {
      |                  ^ Error: Command failed: nvim --server /tmp/pandoc-nvim-preview/nvim.sock --remote-expr join(getline(1, "$"), "\n")
  104 |     encoding: 'utf-8',
  105 |     timeout: 5000,
  106 |   });
  107 |   return stdout.trim();
  108 | }
  109 | 
  110 | export function nvimDirectSend(socketPath: string, keys: string): void {
  111 |   execFileSync('nvim', ['--server', socketPath, '--remote-send', keys], {
  112 |     timeout: 5000,
  113 |   });
  114 | }
  115 | 
  116 | export function nvimDirectQuit(socketPath: string): void {
  117 |   try {
  118 |     execFileSync('nvim', ['--server', socketPath, '--remote-send', ':qa!<CR>'], {
  119 |       timeout: 3000,
  120 |     });
  121 |   } catch {
  122 |     // already gone
  123 |   }
  124 | }
  125 | 
  126 | export interface PandocResult {
  127 |   stdout: string;
  128 |   stderr: string;
  129 |   status: number | null;
  130 |   argv: string[];
  131 | }
  132 | 
  133 | export function pandocRender(markdown: string): PandocResult {
  134 |   const args = [
  135 |     '-f',
  136 |     'markdown+tex_math_dollars+citations',
  137 |     '-t',
  138 |     'html',
  139 |     '--standalone',
  140 |     '--mathjax',
  141 |     '--citeproc',
  142 |   ];
  143 | 
  144 |   const result = spawnSync('pandoc', args, {
  145 |     input: markdown,
  146 |     encoding: 'utf-8',
  147 |     timeout: 5000,
  148 |     maxBuffer: 10 * 1024 * 1024,
  149 |   });
  150 | 
  151 |   return {
  152 |     stdout: result.stdout?.trim() || '',
  153 |     stderr: (result.stderr || '').trim(),
  154 |     status: result.status ?? null,
  155 |     argv: ['pandoc', ...args],
  156 |   };
  157 | }
  158 | 
  159 | export async function killServer(instance: ServerInstance): Promise<void> {
  160 |   // First, try to gracefully kill the nvim child process
  161 |   if (instance.nvimPid > 0) {
  162 |     try {
  163 |       execFileSync('kill', [String(instance.nvimPid)], { timeout: 2000 });
  164 |     } catch {
  165 |       // already dead
  166 |     }
  167 |     await new Promise((r) => setTimeout(r, 200));
  168 |     try {
  169 |       execFileSync('kill', ['-9', String(instance.nvimPid)], { timeout: 2000 });
  170 |     } catch {
  171 |       // already dead
  172 |     }
  173 |   }
  174 | 
  175 |   instance.process.kill('SIGTERM');
  176 |   await new Promise((r) => setTimeout(r, 500));
  177 |   try {
  178 |     instance.process.kill('SIGKILL');
  179 |   } catch {
  180 |     // already exited
  181 |   }
  182 | }
  183 | 
  184 | // Clean up runtime artifacts for a server instance
  185 | export function cleanServerArtifacts(instance: ServerInstance): void {
  186 |   if (existsSync(instance.socketPath)) {
  187 |     rmSync(instance.socketPath);
  188 |   }
  189 |   try {
  190 |     const runDir = '/tmp/pandoc-nvim-preview';
  191 |     if (existsSync(runDir)) {
  192 |       // Only remove our socket, leave dir
  193 |       const socketInDir = join(runDir, 'nvim.sock');
  194 |       if (existsSync(socketInDir)) rmSync(socketInDir);
  195 |     }
  196 |   } catch {
  197 |     // best effort
  198 |   }
  199 | }
  200 | 
```