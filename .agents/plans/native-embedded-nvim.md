# Feature: Neovim Editing Tab

## Status

Proposed. Not a replacement for the CodeMirror editor — an additional editing tab that
hosts a native Neovim instance alongside the existing editor.
All existing data flow (textarea as canonical text, save, render, plugins) stays intact.
Content syncs trivially on tab switch.

## Problem

The current editor is CodeMirror.
Firenvim can optionally take over the textarea with Neovim via a browser extension.
That requires:
- Installing the Firenvim extension
- Installing a Neovim plugin
- Native Messaging host setup
- Focus warfare with arbitrary pages

None of these constraints apply to a single-page app running in a controlled
environment. Firenvim's canvas-based rendering and input stack (see Prior Art) can be
embedded directly into the app — no extension, no overlay, no fighting the page.

## User Outcome

The user opens pandoc-preview and switches to the "Neovim" editing tab to get full modal
editing, motions, completions, treesitter highlighting, etc.
— no browser extension required.
They can switch back to CodeMirror at any time.
Content syncs automatically.

## Can This Already Be Done?

Partially. Firenvim provides the Neovim editing experience but requires a browser
extension. This feature provides the same editing capability natively in the app, with
the app owning the Neovim lifecycle.

## Ownership Analysis

| Concern | Current Owner | Proposed Owner | Change |
| --- | --- | --- | --- |
| Canonical document text | App textarea (CodeMirror) | Unchanged | CodeMirror value remains canonical |
| Text editing (Neovim mode) | Firenvim extension | App-hosted Neovim tab | App spawns/manages nvim |
| Text editing (default) | CodeMirror | Unchanged | — |
| Save target | App/server | Unchanged | — |
| File identity | App/server | Unchanged | — |
| Render invocation | App/server | Unchanged | — |
| Plugin execution | App/server | Unchanged | — |
| Content sync | n/a | App: push content on tab switch | ~3 lines |

Nothing is removed. Nothing about the existing data model changes.
This is purely additive.

## Architecture

```
┌─ Browser ─────────────────────────────────────────────────────┐
│  React App                                                      │
│  ┌─────────────────────────────────────┐  ┌─────────────────┐  │
│  │ Editor tabs: [CodeMirror | Neovim]  │  │ Preview iframe   │  │
│  │ ┌───────────────┐ ┌───────────────┐ │  │ (unchanged)      │  │
│  │ │ <CodeMirror/> │ │ <NeovimEditor>│ │  └─────────────────┘  │
│  │ │ (existing)    │ │ <canvas>      │ │                       │
│  │ │               │ │ <textarea kh> │ │                       │
│  │ └───────────────┘ └──────┬────────┘ │                       │
│  │                          │ WebSocket│                       │
│  └──────────────────────────┼──────────┘                       │
│                             │                                   │
│  ┌──────────────────────────┼──────────────────────────────┐   │
│  │ Express Server           │                               │   │
│  │  /api/save  ←── reads editorContent (same as always)    │   │
│  │  /api/render ←── reads editorContent (same as always)   │   │
│  │  /api/nvim/connect → spawn nvim --headless --listen     │   │
│  │                          │                               │   │
│  │                          ▼                               │   │
│  │               ┌──────────────────┐                       │   │
│  │               │ nvim --headless   │                      │   │
│  │               └──────────────────┘                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Content Synchronization

The key insight: the app's canonical data model does not change.
`editorContent` is still the source of truth for save/render/plugins.
The Neovim tab is just another way to edit it.

```
Tab switch: CodeMirror → Neovim
  1. nvim_buf_set_lines(editorContent)   // push current content to nvim

Tab switch: Neovim → CodeMirror
  1. lines = nvim_buf_get_lines()        // pull content from nvim
  2. setEditorContent(lines.join("\n"))   // update canonical state

Save (Ctrl+S):
  if (activeTab === 'neovim'):
    lines = await nvim.nvim_buf_get_lines()
    setEditorContent(lines.join("\n"))    // sync before save
  POST /api/save { content: editorContent }  // unchanged path

Render (debounced):
  Same as save — sync then render. The render pipeline never knows
  about Neovim; it only sees editorContent.
```

This is ~10 lines of synchronization logic.
The rest of the app is untouched.

## What Would Change

### Keep (unchanged)

- Everything in `App.tsx`: CodeMirror component, `editorContent` state, save/render
  pipeline, debounce, stale render prevention, status bar, dirty tracking
- All server routes: `/api/save`, `/api/render`, `/api/files/*`, `/api/plugins/*`
- All existing tests
- All existing dependencies

### Add

- `src/server/nvim.ts` (~40 lines): spawn nvim `--headless --listen`, return port
- `GET /api/nvim/connect` — returns `{ port }`, lazily spawns nvim on first call
- `src/client/nvim/` directory — ~1,400 lines ported from Firenvim:
  - `renderer.ts`, `keyhandler.ts`, `rpc.ts`, `stdin.ts`, `stdout.ts`, `keys.ts`
- `src/client/NeovimEditor.tsx` (~150 lines new): React component wrapping canvas +
  keyhandler, exposes `getContent()` and `setContent(content)` via imperative handle
- Tab bar in editor pane: "[CodeMirror] / Neovim" toggle
- `activeEditor` state: `'codemirror' | 'neovim'`
- Sync logic: push content on tab enter, pull content on tab leave / save

### Remove

- Nothing. CodeMirror stays.

## Complexity

This is ~300 lines of new app code plus ~1,400 lines ported from Firenvim (renderer +
input + RPC stack). The ported code is mechanical — it already works, it just needs
config injection points cleaned up.

Crucially: no existing code paths change.
The feature is a parallel editor surface that syncs into the existing data model.
If the Neovim tab has a bug, the user switches to CodeMirror and continues working.

## Non-Goals

- Replacing CodeMirror as the default editor
- Live bidirectional sync while Neovim tab is active (auto-save from nvim, etc.)
- Multiple Neovim instances
- Neovim plugin management
- Changing the render pipeline

## Prior Art: Firenvim Architecture Reference

This section captures the concrete mechanisms from
[Firenvim](https://github.com/glacambre/firenvim) (v0.2.17, studied from source at
commit HEAD in May 2026) that an implementer would need.

Firenvim's total codebase is ~4,333 lines.
But only ~1,544 lines are algorithmic (rendering + input + RPC). The remaining ~2,789
lines fight the web: arbitrary page structures, hostile DOM manipulation, extension IPC
routing, browser detection, CSS selector generation, content-editability negotiation,
per-URL config matching.

A native embedding in a controlled single-page app eliminates all of that environmental
complexity. The reusable core is small, clean, and mostly dependency-free.

### Complexity Breakdown

| Category | Lines | What it serves | Our need |
| --- | --- | --- | --- |
| `renderer.ts` | 1,096 | Neovim UI protocol → Canvas | **Keep** (with cuts — see below) |
| `KeyHandler.ts` | 108 | Keyboard input → nvim notation | **Keep** (minor adapt) |
| `Neovim.ts` | 140 | WebSocket + msgpack-RPC + API binding | **Keep** (minor adapt) |
| `Stdin.ts` | 20 | msgpack encoding | **Keep** (as-is) |
| `Stdout.ts` | 60 | msgpack decoding | **Keep** (as-is) |
| `utils/keys.ts` ~90 | Key name tables (`nonLiteralKeys` etc.) | **Keep** (trim — see below) |  |
| `utils/utils.ts` ~15 | `toHexCss`, `parseGuifont` (used by renderer) | **Keep** (extract only these) |  |
| `utils/configuration.ts` ~10 | `NvimMode` type (used by renderer + KeyHandler) | **Keep** (extract only this) |  |
| **Subtotal: reusable core** | **~1,544** |  |  |
| `content.ts` | 285 | CSS selector matching, MutationObserver on entire document, scroll tracking on arbitrary DOM trees | **Delete** — we know exactly which element hosts the editor |
| `FirenvimElement.ts` | 543 | span+shadowDOM overlay, focus warfare, intersection observer, reinsertion vs hostile pages, dynamic positioning | **Delete** — no hostile page to fight |
| `page.ts` | 321 | Extension message routing proxy between frame/content/background | **Delete** — no extension IPC needed |
| `frame.ts` | 227 | iframe lifecycle, temp file I/O, autocmd setup, frame ID management, content sync via `page` proxy | **Delete** — replaced by app state management |
| `background.ts` | 423 | Native Messaging process spawn, per-tab state, icon management, error handling | **Delete** — replaced by server-side spawn |
| `editor-adapter/*` | 499 | Ace, CodeMirror, Monaco detection + content access | **Delete** — we know our content model is plain text |
| `utils/configuration.ts` ~160 | `ISiteConfig`, `GlobalSettings`, per-URL pattern matching, config merging, default overrides | **Delete** — no per-site config needed |  |
| `utils/utils.ts` ~250 | Browser detection (Chrome/Firefox), `executeInPage` (CSP circumvention), `computeSelector` (CSS selector from DOM position), `toFileName` (URL → temp file name) | **Delete** — none of this applies |  |
| `utils/keys.ts` ~69 | `nonLiteralKeyCodes`, `keysToEvents`, `pressKeys` simulation | **Delete** — only needed for `firenvim#press_keys()` which simulates keypresses into arbitrary page elements |  |
| **Subtotal: environmental** | **~2,789** |  | **Delete all** |

## Implementation Design

### Target Architecture

```
┌─ Browser ───────────────────────────────────────────┐
│  React App                                           │
│  ┌─────────────────┐    ┌─────────────────────────┐  │
│  │ <NeovimEditor>  │    │ Toolbar, Explorer,       │  │
│  │ ┌─────────────┐ │    │ Status Bar, Preview      │  │
│  │ │ <canvas>     │ │    │ (unchanged)             │  │
│  │ └─────────────┘ │    └─────────────────────────┘  │
│  │ ┌─────────────┐ │         │                       │
│  │ │ <textarea>   │ │         │ save/render/plugins   │
│  │ │ (keyhandler) │ │         ▼                       │
│  │ └─────────────┘ │    ┌─────────────────────────┐  │
│  └─────────────────┘    │ Express Server           │  │
│         │               │ ┌─────────────────────┐  │  │
│         │ WebSocket     │ │ Spawn: nvim          │  │  │
│         │ msgpack-RPC   │ │   --headless         │  │  │
│         ▼               │ │   --listen 127.0.0.1 │  │  │
│  ┌─────────────────┐    │ └─────────────────────┘  │  │
│  │ nvim --headless  │    └─────────────────────────┘  │
│  └─────────────────┘                                  │
└──────────────────────────────────────────────────────┘
```

### Server: Process Manager (~50 lines new)

```typescript
// src/server/nvim.ts
import { spawn, ChildProcess } from 'child_process';
import { createServer, AddressInfo } from 'net';

// Find a free port, spawn nvim, return the port
export async function startNvim(): Promise<{ port: number; process: ChildProcess }> {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    server.close();

    const proc = spawn('nvim', [
        '--headless',
        `--listen`, `127.0.0.1:${port}`,
        '-u', 'NONE',         // skip user config (load our own)
        '+set', 'laststatus=0', // minimal UI
        '+set', 'mouse=a',     // enable mouse
    ], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.on('exit', (code) => {
        // restart? log? TBD
    });

    return { port, process: proc };
}

// Add to src/server/index.ts:
// const { port } = await startNvim();
// Expose via new endpoint or in initial page data
```

**Key decisions:**
- Uses `net.createServer` to find a free port (no hardcoded port)
- Spawns with `-u NONE` to isolate from user config; pandoc-preview provides its own
  minimal init
- `--listen 127.0.0.1:{port}` exposes the msgpack-RPC endpoint
- Client connects via `new WebSocket(\`ws://127.0.0.1:${port}\`)` — no password needed
  on loopback

### Client: Editor Component (~200 lines new + ~1,544 lines ported)

The `<NeovimEditor>` React component is an additional editor surface — it lives
alongside CodeMirror, not in place of it.
The app renders one or the other based on `activeEditor` state:

```
src/client/nvim/
├── renderer.ts    (ported from Firenvim, ~1,096 lines, minor adapt)
├── keyhandler.ts  (ported from Firenvim, ~108 lines, minor adapt)
├── rpc.ts         (new, ~60 lines — replaces Neovim.ts)
├── stdin.ts       (ported from Firenvim, ~20 lines, no changes)
├── stdout.ts      (ported from Firenvim, ~60 lines, no changes)
├── keys.ts        (extracted from Firenvim utils/keys.ts, ~90 lines)
├── types.ts       (extracted: NvimMode type, ~10 lines)
├── utils.ts       (extracted: toHexCss, parseGuifont, ~15 lines)
└── NeovimEditor.tsx (new, ~200 lines — React wrapper)
```

**rpc.ts** (replaces Firenvim's Neovim.ts):
```typescript
// Opens WebSocket, sets up msgpack RPC, binds Neovim API dynamically
// ~60 lines vs Firenvim's 140 (drops page proxy, settings, canvas setup,
// notification handling — those move to the React wrapper)

export async function connect(port: number) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.binaryType = 'arraybuffer';
    await new Promise(resolve => socket.addEventListener('open', resolve));

    const stdin = new Stdin(socket);
    const stdout = new Stdout(socket);
    stdout.setTypes(/* from nvim_get_api_info */);

    const requests = new Map<number, {resolve: any, reject: any}>();
    let reqId = 0;
    const nvim: any = {};

    const request = (method: string, args: any[]): Promise<any> => {
        return new Promise((resolve, reject) => {
            reqId += 1;
            requests.set(reqId, { resolve, reject });
            stdin.write(reqId, method, args);
        });
    };

    stdout.on('response', (id, error, result) => {
        const r = requests.get(id);
        if (r) { requests.delete(id); error ? r.reject(error) : r.resolve(result); }
    });

    stdout.on('notification', (name, args) => {
        // Forward redraw events to renderer, firenvim_* notifications to app
    });

    const { 0: channel, 1: apiInfo } = await request('nvim_get_api_info', []);
    apiInfo.functions.forEach((f: any) => {
        nvim[f.name] = (...args: any[]) => request(f.name, args);
    });

    return { nvim, socket, stdout, channel };
}
```

**NeovimEditor.tsx** (React wrapper):
```tsx
//  ~200 lines — manages lifecycle: connect, ui_attach, keyhandler, resize, save

function NeovimEditor({ initialContent, onSave, onModeChange }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const khRef = useRef<HTMLTextAreaElement>(null);
    const [mode, setMode] = useState<string>('normal');
    const nvimRef = useRef<any>(null);

    useEffect(() => {
        const init = async () => {
            const resp = await fetch('/api/nvim/connect');
            const { port } = await resp.json();

            const { nvim, stdout } = await connect(port);
            nvimRef.current = nvim;

            // Set up renderer
            setCanvas(canvasRef.current!);
            setSettings({ cmdline: 'none', renderer: 'canvas' });

            // Set up key handler
            const kh = new KeyHandler(khRef.current!, { /* minimal config */ });
            kh.on('input', (s: string) => nvim.nvim_input(s));

            // Attach UI
            await nvim.nvim_ui_attach(cols, rows, {
                ext_linegrid: true,
                ext_messages: true,
                rgb: true,
            });

            // Load content
            await nvim.nvim_buf_set_lines(0, 0, -1, false, initialContent.split('\n'));

            // Track mode for app status bar
            rendererEvents.on('modeChange', (m: any) => {
                setMode(m);
                onModeChange?.(m);
            });

            // Handle resize
            const observer = new ResizeObserver(() => {
                // Recompute grid size, call nvim_ui_try_resize_grid
            });
            observer.observe(canvasRef.current!.parentElement!);
        };
        init();

        // Cleanup
        return () => {
            nvimRef.current?.nvim_ui_detach();
            nvimRef.current?.nvim_command('qall!');
        };
    }, []);

    // Expose save to parent via imperative handle
    useImperativeHandle(ref, () => ({
        getContent: async () => {
            const lines = await nvimRef.current.nvim_buf_get_lines(0, 0, -1, false);
            return lines.join('\n');
        },
        isModified: async () => nvimRef.current.nvim_buf_get_option(0, 'modified'),
    }));

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
            <textarea
                ref={khRef}
                style={{ height: 1, opacity: 0.01, position: 'absolute', overflow: 'hidden' }}
            />
        </div>
    );
}
```

**Adaptations to Firenvim's renderer.ts:**
- Remove `confReady`/`getGlobalConf()` calls — inject config via `setSettings()`
  constructor parameter
- Remove `settings.cmdline === "none"` conditional — we don't need external commandline
- Remove grid-ID parameterization — always use grid `1`
- The file is otherwise dependency-free and usable as-is

**Adaptations to Firenvim's KeyHandler.ts:**
- Replace `getGlobalConf()` with constructor-injected config
- Remove per-mode `ignoreKeys` — no browser shortcuts to allow through
- Remove Chrome `compositionend` workaround if pandoc-preview targets a single browser

### Content Synchronization

```
Tab switch: CodeMirror → Neovim
  nvim_buf_set_lines(editorContent)         // push current content in

Tab switch: Neovim → CodeMirror
  lines = nvim_buf_get_lines()              // pull content out
  setEditorContent(lines.join("\n"))        // update canonical state

Save (Ctrl+S) — same as today, plus a pre-sync:
  if (activeTab === 'neovim') {
    lines = nvim_buf_get_lines()
    setEditorContent(lines.join("\n"))      // sync before save
  }
  POST /api/save { content: editorContent } // EXISTING path, unchanged

Render (debounced) — same as today:
  POST /api/render { markdown: editorContent }  // EXISTING path, unchanged
```

The render and save pipelines never know about Neovim.
They only see `editorContent`. The sync is ~10 lines in `App.tsx`.

### Test Strategy

```typescript
// src/tests/nvim.spec.ts
// Requires nvim on PATH. Uses NVIM_APPNAME=pandoc-preview-test to isolate.

test.beforeAll(async () => {
    // Write minimal init.lua to temp config dir
    await exec('nvim --headless -u NONE +qa'); // verify nvim is available
});

test('nvim editor loads and returns content', async () => {
    // Start server, get port, connect WebSocket
    // nvim_ui_attach, nvim_buf_set_lines
    // Assert nvim_buf_get_lines returns original content
});

test('save writes nvim buffer content to disk', async () => {
    // Set buffer content via nvim
    // POST /api/save
    // Assert file on disk matches
});
```

### Package Dependencies

| Package | Purpose | Already in project? |
| --- | --- | --- |
| `msgpack-lite` | msgpack encoding/decoding for RPC | **No** — add |
| `@types/msgpack-lite` | TypeScript types | **No** — add |

No existing packages are removed.
CodeMirror and its dependencies stay.

### Line Budget

| Component | Lines | Source |
| --- | --- | --- |
| `src/server/nvim.ts` | ~50 | New — process spawn |
| `src/client/nvim/renderer.ts` | ~1,096 | Ported + trimmed |
| `src/client/nvim/keyhandler.ts` | ~108 | Ported + trimmed |
| `src/client/nvim/rpc.ts` | ~60 | New — simplified Neovim.ts |
| `src/client/nvim/stdin.ts` | ~20 | Ported as-is |
| `src/client/nvim/stdout.ts` | ~60 | Ported as-is |
| `src/client/nvim/keys.ts` | ~90 | Extracted |
| `src/client/nvim/types.ts` | ~10 | Extracted |
| `src/client/nvim/utils.ts` | ~15 | Extracted |
| `src/client/nvim/NeovimEditor.tsx` | ~200 | New — React wrapper |
| `src/tests/nvim.spec.ts` | ~100 | New — tests |
| **Total new code** | **~1,809** |  |
| CodeMirror and existing data flow | **Unchanged** |  |
| **Net new: ~1,800 lines.** No existing code removed. |  |  |

## Related

- Firenvim source: `https://github.com/glacambre/firenvim`
- Key modules: `frame.ts`, `Neovim.ts`, `renderer.ts`, `KeyHandler.ts`, `Stdin.ts`,
  `Stdout.ts`
- Existing plans: `FEATURE-EVALUATION-FRAMEWORK.md`, `plugin-system-implementation.md`
