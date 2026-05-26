# Feature Card: Diagram Toolbar Button with Injection Modal

## User Outcome

The user can create, edit, and inject diagrams into their markdown document using
multiple tools — clipboard images, web-based TikZ editors, desktop TikZ editors,
Inkscape, and free-form handwriting in Xournal — without manually managing file paths,
figure directories, or filter integration.
The injected content produces correct output through the configured render pipeline
because it respects the existing TikZ lua filter infrastructure and custom Xournal
filter.

A companion filters configuration modal lets the user choose which `~/.pandoc/filters/`
Lua filters are enabled, synced with the app's CLI config.

## Can This Already Be Done?

Each of these *can* be done manually outside the app:

- **Clipboard image**: Open an external image app, paste, save to `./figures/`, type the
  `![](./figures/...)` reference by hand.
- **FreeTikZ/quiver**: Draw in a browser tab, copy the TikZ output, switch back to the
  editor, paste it into a fenced code block or raw TeX block.
- **Qtikz/Tikzit**: Create a file on disk, open the desktop app, save, type the
  `\tikzfig{}` or `\input{}` reference by hand.
- **Inkscape**: Create an SVG in `./figures/`, open in Inkscape, draw, export to
  PDF+LaTeX via CLI, type the `\input{}` reference by hand.
- **Xournal**: Create a `.xopp` file manually, open in Xournal++, draw, save, install a
  custom pandoc filter to convert it at render time, type the fenced code block by hand.

What the app provides is **one-button access** to all of these, awareness of the current
file's workspace, cursor-relative injection, and guaranteed compatibility with the
render pipeline that the central `~/.pandoc/filters/` already supports.

Losing none of the above if unimplemented: the user can still use the external tools.
This feature is about reducing context-switching friction and preventing injection
errors (wrong path, wrong markup, missing tikzcd filter in pandoc args).

## Which Layer Owns the Outcome

| Sub-outcome | Owner | Rationale |
| --- | --- | --- |
| Diagram button + modal UI | Client (App.tsx) | Browser UI element |
| Web tool iframes (FreeTikZ, quiver) | Client (in-iframe rendering) | Browser can embed third-party pages |
| Injected "Export" script + postMessage bridge | Client (injected into iframe) | Same protocol for all web tools; postMessage crosses origin |
| Export code extraction / DOM scraping | Client (injected script in iframe) | Injected script reads a configured CSS selector |
| Cursor injection of generated TikZ/image markup | Client (CodeMirror API) | Only the browser has cursor position |
| Clipboard image read | Client (navigator.clipboard.read) | Browser Clipboard API |
| Clipboard image file write to `./figures/` | Server (new endpoint) | Filesystem access lives on the server |
| Desktop app file creation + launch (Qtikz, Tikzit, Inkscape, Xournal) | Server (plugin system) | `spawn` with file path needs filesystem |
| TikZ code block detection and SVG rendering | Pandoc lua filter | Already owned by `~/.pandoc/filters/tikzcd*.lua` |
| Xournal `.xopp` → SVG conversion at render time | Pandoc lua filter (`xournal.lua`) | Custom filter intercepts `` ``` {.xournal} `` blocks |
| Filter configuration (checkbox list + CLI sync) | Client + config file | UI renders from file scan; writes back to config |
| Portable default filters shipped with app (tikzcd, xournal) | Server (bundled assets) | App installs them to `~/.pandoc/filters/` on first run |
| Save gate (block until file is real) | Client + server | Standard flow: temp file → save-as → proceed |
| `./figures/` directory auto-creation | Server (in figure endpoints) | Created relative to saved file's directory |

## Design Decisions (from user)

1. **Filters config UI**: The app exposes a modal that reads `~/.pandoc/filters/` (and
   `~/.pandoc/bin/` for legacy), displaying available Lua filters as a checkbox list.
   This list stays in sync with the CLI `--lua-filter` args written to the config file
   (currently `pandoc-preview.toml`).

2. **Portable tikzcd.lua + default filter shipping**: `tikzcd.lua` must be audited and
   its hardcoded paths made portable (resolve `~/.pandoc/` at runtime instead of
   hardcoded `/home/dzack/...` paths).
   The app ships a set of default Lua filters that can be installed into
   `~/.pandoc/filters/` on first launch, including a portable version of `tikzcd.lua`.

3. **Common iframe + injected script protocol**: All web-based diagram tools (FreeTikZ,
   quiver) use a **single shared interface**: an iframe embedding the remote URL, with a
   content script injected into the iframe that:
   - Adds a floating "Export to Document" button overlay
   - On click, reads the code from a **tool-specific CSS selector** within the iframe
     DOM
   - Sends the extracted code back to the host app via `postMessage`
   - The host app receives the message and inserts the code at the editor cursor

   The injected script is generic — it is configured per tool with `{ url, selector }`.
   The app is **not redistributing anything**; the iframe loads the actual remote
   website. The injected script is a lightweight overlay added via the iframe
   sandbox/proxy.

4. **Save gate**: All diagram actions require a saved file.
   If the current file is a temp file, the standard save-as dialog fires first.
   Once a real path is established, the `./figures/` directory is created relative to
   that file's directory.
   The gate is the same pattern already used by the plugin system (`isTempFile` check in
   `App.tsx`).

5. **No redistribution**: The app never bundles FreeTikZ, quiver, or any web tool.
   The iframes point to the actual remote URLs.
   The only code the app ships is the injected content script and the default Lua
   filters (which are small, portable, and owned by this project).

## Research Findings

### Tool Summaries

| Tool | Type | CSS Selector for Code | Output Format | Styles/Packages Needed |
| --- | --- | --- | --- | --- |
| FreeTikZ | Web app (D3.js) | `#latex` (textarea) | `\begin{tikzpicture}...\end{tikzpicture}` | `freetikz.sty` (in `~/.pandoc/styles/`) |
| quiver | Web app (SPA) | TBD (export dialog textarea) | `\begin{tikzcd}...\end{tikzcd}` | `quiver.sty` (in `~/.pandoc/styles/`) |
| Qtikz | Desktop (Qt) | N/A — file-based | `.tex` file with `tikzpicture` | Standard TikZ |
| Tikzit | Desktop (Qt) | N/A — file-based | `.tikz` file + `\ctikzfig{stem}` | `tikzit.sty` (in `~/.pandoc/styles/`) |
| Inkscape | Desktop (SVG editor) | N/A — file-based | SVG → PDF+LaTeX via `\input{./figures/<stem>.pdf_tex}` | Standard TikZ / `svg` package |
| Xournal | Desktop (handwriting) | N/A — file-based | `` ``` {.xournal}\n./figures/<stem>.xopp\n``` `` → SVG via lua filter | `xournal.lua` (bundled filter) |
| Clipboard | OS clipboard | N/A | `![](./figures/filename.png)` | None |

### Common Iframe Protocol for Web Tools

All web-based tools share this flow:

```
┌─ Host App ─────────────────────────────┐
│  DiagramModal                           │
│  ┌─ iframe (remote URL) ────────────┐   │
│  │  [Tool UI]                        │   │
│  │                          ┌──────┐ │   │
│  │  [Inject] Export → ────→│Scrape│ │   │
│  │  (floating button)       │DOM   │ │   │
│  │                          │sel.  │ │   │
│  │                          └──┬───┘ │   │
│  └──────────────────────────────┼─────┘   │
│                    postMessage(code)       │
│                                 ↓         │
│  Receive code → insert at cursor position  │
└───────────────────────────────────────────┘
```

The injected script is a small JS payload that:

1. Waits for the iframe page to load
2. Creates a floating `<button>` with `position: fixed; z-index: 9999`
3. On click, runs `document.querySelector(selector).value` (or `.textContent`)
4. Sends result to parent via
   `window.parent.postMessage({ type: 'diagram-export', code, tool })`
5. Host app has a `message` event listener that handles the response

**Implementation detail**: The script injection requires either:
- A local proxy server that wraps the remote page and injects the script (simplest)
- Using `srcdoc` + a hidden iframe that loads the remote page (more complex)

The proxy approach: the app has a server endpoint `/api/diagram/proxy?url=...` that
fetches the remote page, injects the content script before `</body>`, and serves it
same-origin. This eliminates cross-origin issues entirely for the iframe embedding.

### Per-Tool Selector Research

#### FreeTikZ

DOM structure (confirmed from source at
`https://homepages.inf.ed.ac.uk/cheunen/freetikz/freetikz.html`):

```html
<div id="latex-wrap">
  <textarea id="latex">
\documentclass{standalone}
\usepackage{freetikz}
\begin{document}
\begin{tikzpicture}
... content ...
\end{tikzpicture}
\end{document}
  </textarea>
</div>
```

**Selector**: `#latex` **Extraction**: Read `.value`, extract content between
`\begin{document}` and `\end{document}`, trim whitespace.
The result is a bare `tikzpicture` environment.

#### quiver

quiver's export dialog appears on Ctrl+E. The DOM structure needs inspection at runtime
(the app uses React with dynamically generated class names).
The export dialog contains a readonly textarea or pre-formatted code block with the
tikz-cd output.

**Probable selector**: Something in the export dialog's DOM. This needs empirical
verification by loading the page and inspecting the export popup.
The selector will be a tool-specific configuration parameter.

**Fallback**: If the export dialog DOM is too unstable, use the URL hash approach:
quiver serializes the diagram state in `window.location.hash`. The injected script can
read the hash and send it back; the host app reconstructs the diagram URL or prompts the
user to use the built-in "Copy" button.

**Note**: The tikzcd lua filters handle `\begin{tikzcd}...\end{tikzcd}` natively.
Extraction is straightforward once the element is located.

### Desktop Editor Details

#### Qtikz

- CLI: `qtikz <filename>` (Ubuntu package `qtikz`)
- Edits `.tex` files containing `tikzpicture`
- Template exists at `~/.pandoc/config/qtikz-template.pgs`
- The app creates `<stem>-<hash>.tikz.tex` in `./figures/` and launches Qtikz detached
- Injection is immediate with a template; user can re-open the file for later edits
- The file is available for `\input{}` if the user prefers that pattern

#### Tikzit

- CLI: `tikzit <filename>.tikz` (Ubuntu package `tikzit`)
- Uses `.tikz` files, not `.tex`
- Inclusion via `\tikzfig{<stem>}` or `\ctikzfig{<stem>}`
- `tikzit.sty` provides `\ctikzfig{}` which searches `<stem>.tikz` and
  `./figures/<stem>.tikz`
- `~/.pandoc/styles/tikzit.sty` is already loaded by `dzg-unified.sty`
- The app creates `<stem>.tikz` in `./figures/` and launches Tikzit detached
- Injects `\ctikzfig{<stem>}` — the path resolution is handled by `tikzit.sty` at
  compile time

#### Inkscape

- CLI: `inkscape <filename>.svg` (opens GUI);
  `inkscape --export-filename=<out>.pdf --export-latex <filename>.svg` for headless
  export
- Inkscape is a full vector graphics editor; the diagram is authored inside the Inkscape
  GUI, not via code
- The app creates an empty `<stem>.svg` in `./figures/` (or a template with the diagram
  title as a text label) and launches Inkscape detached
- After the user saves in Inkscape, the app (or a server-side watcher) runs:
  ```
  inkscape --export-filename=./figures/<stem>.pdf --export-latex ./figures/<stem>.svg
  ```
  This produces `<stem>.pdf` + `<stem>.pdf_tex`. The `.pdf_tex` file contains an
  `\includegraphics` that references the PDF with proper LaTeX bounding box and optional
  text-overlay support.
- **Injection**: `\input{./figures/<stem>.pdf_tex}` — the PDF is included as a full-page
  figure, and any text elements authored in Inkscape are overlaid by LaTeX at compile
  time (the `--export-latex` feature handles this).
- **LaTeX formulas within Inkscape**: The [textext](https://github.com/textext/textext)
  plugin provides Inkscape-native text objects that render LaTeX (re-editable).
  Inkscape 1.x also has a built-in
  `Extensions → Render → Mathematics → LaTeX (pdflatex)...` menu item for one-shot LaTeX
  formula rendering.
- **Alternative export formats**: `svg2tikz` extension (bundled as `inkscape2tikz`) can
  export Inkscape SVG as TikZ/PGF code, which can be `\input{}`-ed directly into a
  `tikzpicture` environment rather than as a PDF image.
- **Template**: Optionally ship a starter SVG with pre-configured page dimensions
  matching the document's text width (e.g., `\textwidth`-aligned viewBox).

#### Xournal

Xournal is fundamentally different from the other desktop tools: it produces hand-drawn
content in `.xopp` format rather than TikZ code.
The primary inclusion mechanism is a **pandoc lua filter** (`xournal.lua`) that
intercepts fenced code blocks tagged `{.xournal}` and converts the referenced `.xopp`
file to an SVG at render time.
This means the `.xopp` file becomes a source-tracked asset alongside the markdown.

- CLI: `xournalpp <filename>.xopp` (opens GUI); `xournalpp -i <output>.svg <input>.xopp`
  for headless SVG export

- The app creates an empty `<stem>.xopp` in `./figures/` and launches Xournal++ detached

- **Filter-based injection** (primary):
  ````markdown
  ``` {.xournal}
  ./figures/<stem>.xopp
  ```
  ````
  A bundled `xournal.lua` filter intercepts this `CodeBlock([".xournal"], ...)` and at
  render time:
  1. Reads the path from the code block body
  2. Runs `xournalpp -i <output>.svg <path>.xopp --export-no-background`
  3. Converts the SVG to a data URI or writes it alongside the document
  4. Emits `<img src="...">` in HTML output; `\includegraphics{}` in LaTeX

  This avoids any intermediate export step — the user just draws and saves in Xournal,
  and the filter handles the conversion.

- **Screenshot export** (alternative): Three strategies for getting Xournal content into
  the document as a static image:

| Strategy | Tools | Flow | Notes |
| --- | --- | --- | --- |
| System region capture | `flameshot gui` | Launch flameshot GUI, select region → clipboard → app's "From Clipboard" | Works on X11/Wayland; post-crop is manual |
| Bundled lightweight capture | `grim + slurp` (Wayland-native) | App runs `grim -g "$(slurp)"` → captures selection → saves to `./figures/` | No external GUI; entirely scriptable; needs `wl-clipboard` for clipboard |
| Auto-crop export | Scripted `xournalpp -i` + crop | Export to SVG, then run `inkscape --export-area-drawing` to trim whitespace | Fully automated; best for committed assets |

If the screenshot route is taken, Xournal acts as a "launch → draw → capture → inject"
pipeline similar to the clipboard image flow, but with an Xournal launch step before the
capture.

- **Re-editable source**: The `.xopp` file persists in `./figures/` and can be reopened
  from the app later. Changes to the `.xopp` take effect on next render (filter-based) or
  require a new screenshot (image-based).

- **Template**: Optionally ship a starter `.xopp` with a single blank page sized to
  match the document's text width, so the user doesn't need to configure page
  dimensions.

### Clipboard Image Injection

**Flow**:

1. User copies image to clipboard (screenshot, exported SVG, etc.)
2. In the app, clicks "Diagram → From Clipboard"
3. **Save gate**: if current file is temp, prompt save-as first
4. Browser reads clipboard via `navigator.clipboard.read()` (requires `clipboard-read`
   permission under secure context)
5. Sends image data (as base64 or blob) to server via `POST /api/figures`
6. Server creates `./figures/` relative to the saved file's directory if absent
7. Server generates a filename (`<uuid>.<ext>`), saves the image
8. Server returns the relative path (`./figures/<uuid>.<ext>`)
9. Client inserts `![](./figures/<filename>)` at the cursor position

**Permissions**: `clipboard-read` works on localhost (the app's dev domain).
In production, requires HTTPS.

### Existing TikZ Filter Infrastructure

The following Lua filters exist in `~/.pandoc/bin/`:

| File | Purpose |
| --- | --- |
| `tikzcd.lua` | Detects `\begin{tikzcd}` and `\begin{tikzpicture}` raw blocks; compiles to SVG via `pdflatex` + `pdf2svg`; caches by SHA1; emits `<img class="tikz">` for HTML |
| `tikzcd2.lua` | Variant using `tikz_to_svg.sh` helper |
| `tikzcd_figure_filter.lua` | Wraps tikzcd in `figure[H]` for LaTeX output |
| `wrap_tikzcd_semantic.lua` | Wraps tikzcd in DisplayMath |
| `html_image_filter.lua` | General HTML image filter |

**Critical observation**: The current `pandoc-preview.toml` does NOT include any tikzcd
filter:

```toml
[pandoc]
args = [
  "--lua-filter=~/.pandoc/filters/convert_amsthm_envs.lua",
  # No tikzcd filter here
]
```

Without the filter, injected `\begin{tikzcd}...\end{tikzcd}` blocks pass through as raw
LaTeX in the HTML output — they will not render as SVGs.

**The `tikzcd.lua` filter has hardcoded paths** (e.g.,
`/home/dzack/.pandoc/macros/preamble_common`). This must be made portable by resolving
paths relative to `~/.pandoc/` at runtime before it can be shipped.

### Check: Pandoc raw TeX block parsing

The `-f markdown+tex_math_dollars+citations` format **does** parse raw TeX blocks as
`RawBlock('tex', ...)`:

````markdown
``` {.tex}
\begin{tikzcd}
A \arrow[r, "f"] & B
\end{tikzcd}
```
````

This produces `RawBlock('tex', '\begin{tikzcd}\nA \\arrow[r, "f"] & B\n\\end{tikzcd}')`,
which the lua filter can intercept.

Direct inline LaTeX also works as a `RawBlock` when it starts a line:

```markdown
\begin{tikzcd}
A \arrow[r, "f"] & B
\end{tikzcd}
```

This is the standard injection format.

## Proposed Architecture

### 1. Filter Configuration Modal

A new modal accessible from the toolbar (or Settings menu) that:

1. Reads directory `~/.pandoc/filters/` (and also `~/.pandoc/bin/` for backward compat)
   for files matching `*.lua`
2. Displays each as a checkbox, with the filter name derived from the filename
3. Currently-enabled filters (from `pandoc-preview.toml`) are checked by default
4. Toggling a checkbox adds/removes `--lua-filter=<path>` from the pandoc args in config
5. Changes persist to `pandoc-preview.toml` via `POST /api/config`

This replaces the hardcoded `--lua-filter` list in config with a UI-managed one.
The filter modal is also accessible from the Diagram modal as a gear/settings link
(since the diagram feature depends on the tikzcd filter being enabled).

**Backend**: A new `/api/filters` endpoint:
- `GET /api/filters` — scans `~/.pandoc/filters/` and `~/.pandoc/bin/`, returns list
  with `{ name, path, enabled }` status compared against current pandoc args
- `POST /api/filters` — accepts `{ enabled: string[] }` of filter paths, writes updated
  `--lua-filter` args into `pandoc-preview.toml`

### 2. Portable tikzcd.lua + Default Filters

**Tasks**:

1. Audit `tikzcd.lua` for hardcoded paths — replace with `~/.pandoc/` resolution at
   runtime using `os.getenv('HOME')` or `pandoc.path` utilities
2. Audit the preamble includes: `tikzcd.lua` references
   `/home/dzack/.pandoc/macros/preamble_common` — replace with
   `os.getenv('HOME') .. '/.pandoc/macros/preamble_common'`
3. Create a portable version at `src/server/filters/tikzcd.lua` in the app repo
4. On first launch (or via an "Install Default Filters" action), copy bundled filters
   from `src/server/filters/` to `~/.pandoc/filters/` (creating the directory if absent)
5. Ensure `pdflatex` and `pdf2svg` availability is checked at filter install time

**tikzcd.lua audit (hardcoded paths found)**:

The current `~/.pandoc/filters/tikzcd.lua` has these portability blockers:

| Line | Issue | Fix |
| --- | --- | --- |
| 2 | `package.path = package.path .. ';' .. '/home/dzack/.pandoc/filters/?.lua;'` | Replace with `os.getenv('HOME') .. '/.pandoc/filters/?.lua'` or use pandoc's built-in path resolution |
| 7 | `\input{/home/dzack/.pandoc/macros/preamble_common}` in template string | Replace with `\input{` .. pandoc_user_dir .. `/styles/macros/tikz.tex}` or generate a minimal standalone preamble |
| 37 | `/tmp/<sha1>.svg` output path | OK — `/tmp` is universal; use SHA1 hash for uniqueness (no collision) |
| 41 | `io.open('/tmp/tikz.tex', 'w')` — shared temp file | Replace with unique temp path using `pandoc.sha1` like `tikzcd2.lua` does; concurrent pandoc invocations will clobber each other |
| 45 | `pdflatex /tmp/tikz.tex` — shell command | OK — filename is controlled, no injection risk |

**Preamble dependency**: `preamble_common` does NOT exist at the hardcoded path
`~/.pandoc/macros/preamble_common`. The `~/.pandoc/macros/` directory does not exist —
the macros are at `~/.pandoc/styles/macros/`. The filter as-is will fail on any machine
(including this one).
The portable version must either:

- Generate a self-contained preamble: `\documentclass{standalone}` with the specific
  TikZ libraries needed (arrows.meta, cd, shapes, positioning, decorations, calc)
- Reference `~/.pandoc/styles/macros/tikz.tex` for the user's custom styles
- Reference `~/.pandoc/styles/dzg-unified.sty` for the full unified style bundle (this
  includes quiver, tikzit, dynkin-diagrams, etc.)

**Recommendation**: Use the `standalone` class with a minimal set of TikZ libraries
(arrows.meta, cd, decorations.pathreplacing, decorations.markings, shapes, positioning,
calc, fit, backgrounds, hobby, math) as the default preamble.
Conditionally include `~/.pandoc/styles/macros/tikz.tex` if it exists for user-defined
styles. This matches what `render_figures.py` already does.

**Bundled filters to ship**:

| Source | Portable version path |
| --- | --- |
| `tikzcd.lua` (audited) | `src/server/filters/tikzcd.lua` |
| `tikzcd_figure_filter.lua` | `src/server/filters/tikzcd-figure.lua` |
| `wrap_tikzcd_semantic.lua` | `src/server/filters/tikzcd-semantic.lua` |
| `xournal.lua` (new) | `src/server/filters/xournal.lua` |

### 3. Common Iframe Protocol

A shared module for creating tool-specific iframes:

```typescript
type WebToolConfig = {
  id: string;
  name: string;
  url: string;
  selector: string;         // CSS selector for the code element
  extract: 'value' | 'textContent';  // how to read the element
  postProcess?: (raw: string) => string;  // e.g., strip \begin{document}
  injectFormat: 'raw-tex' | 'markdown-image' | 'latex-command';
};
```

**Server-side proxy endpoint**:
`GET /api/diagram/proxy?url=<encoded>&selector=<encoded>`

- Fetches the remote page content
- Injects a content script (`<script>`) before `</body>`
- The script creates the floating "Export to Document" button
- On click, reads `document.querySelector(selector)`, sends via `postMessage`
- Serves the modified HTML same-origin

**Client-side handler**: A `message` event listener in `DiagramModal`:

```typescript
useEffect(() => {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'diagram-export') {
      const { code, tool } = event.data;
      // cursor injection logic
      insertAtCursor(formatForInsertion(code, tool));
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}, []);
```

**Pre-configured tool entries**:

```typescript
const WEB_TOOLS: WebToolConfig[] = [
  {
    id: 'freetikz',
    name: 'FreeTikZ',
    url: 'https://homepages.inf.ed.ac.uk/cheunen/freetikz/freetikz.html',
    selector: '#latex',
    extract: 'value',
    postProcess: (raw) => {
      const match = raw.match(/\\begin{document}(.*?)\\end{document}/s);
      return match ? match[1].trim() : raw;
    },
    injectFormat: 'raw-tex',
  },
  {
    id: 'quiver',
    name: 'quiver',
    url: 'https://q.uiver.app/',
    selector: '', // TBD — needs empirical DOM inspection
    extract: 'value',
    injectFormat: 'raw-tex',
  },
];
```

### 4. Save Gate

Reuse the existing `isTempFile` pattern from `App.tsx`. All diagram actions check:

```typescript
if (isTempFile) {
  // Trigger the save-as dialog (same as plugin gate)
  const path = await promptForSavePath('save');
  if (path === null) return; // user cancelled
  // Save first, then proceed
  await saveTo(path);
}
```

Once a real path is established, the server creates `./figures/` relative to the file's
directory on the first figure write.
The path is returned to the client for insertion.

The save gate applies to:
- Clipboard image injection (needs a real path to know where `./figures/` goes)
- Qtikz file creation (file goes in `./figures/` relative to saved document)
- Tikzit file creation (same)
- Inkscape file creation (same)
- Xournal file creation (same)
- Region capture (needs to know where to save the screenshot)
- Web tool exports (the injected code references the document context; the save gate
  ensures there IS a document context)

### 5. No Redistribution

The app does not bundle FreeTikZ, quiver, or any third-party web tool.

The proxy endpoint fetches the remote page at runtime and injects only the lightweight
content script. If the remote tool is unavailable, the user sees the connection error in
the iframe (same as any embedded page).
The app has no offline fallback for web tools — that is acceptable since desktop editors
(Qtikz, Tikzit, Inkscape, Xournal) and clipboard images don't depend on network.

### UI Components

1. **DiagramButton** — toolbar icon (e.g., `Image` or `PenTool` from Lucide) next to
   existing icons. Also available in the menubar under "Insert → Diagram".

2. **FilterSettingsButton** — a gear icon in the status bar or Preferences area that
   opens the filter configuration modal.
   Also linked from DiagramModal as "Filters...".

3. **DiagramModal** — Radix Dialog triggered by the button, containing:

   Section 1 — **Web Tools** (iframed editors):
   - FreeTikZ row: name + "Open" button → opens iframe with injected Export overlay
   - quiver row: name + "Open" button → same pattern

   Section 2 — **Desktop Editors**:
   - Qtikz row: name + "Create & Edit" → creates file, spawns Qtikz, injects template
   - Tikzit row: name + "Create & Edit" → same pattern
   - Inkscape row: name + "Create & Edit" → creates empty `<stem>.svg` in `./figures/`,
     spawns Inkscape detached; after user saves, optionally runs
     `inkscape --export-latex` to produce PDF+LaTeX pair; also has "Export as PDF (with
     LaTeX overlay)" button for headless re-export
   - Xournal row: name + "Create & Edit" → creates empty `<stem>.xopp` in `./figures/`,
     spawns xournalpp detached; two injection options:
     - "Insert as Xournal block" → injects
       `` ``` {.xournal}\n./figures/<stem>.xopp\n``` `` (recommended — filter-based,
       re-renders on each preview)
     - "Capture screenshot" → runs `grim -g "$(slurp)"` (or `flameshot gui`) to capture
       a region, saves to `./figures/<stem>.png`, injects `![](...)`

   Section 3 — **From Clipboard**:
   - Single button: "Paste Image from Clipboard" → save-gate → clipboard read → inject

   Section 4 — **Filter Status**:
   - Small indicator showing which lua filters are currently enabled
   - "Configure Filters..." link that opens the FilterSettingsModal

4. **FilterSettingsModal** — Radix Dialog with checkbox list of available lua filters
   from `~/.pandoc/filters/` and `~/.pandoc/bin/`.

### Server Integration

New endpoints:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/figures` | POST | Accept image binary/Base64, save to `./figures/`, return relative path |
| `/api/diagram/file` | POST | Accept `{ type: 'qtikz' |
| `/api/diagram/launch` | POST | Accept `{ file: string, command: string }`, spawn desktop editor detached |
| `/api/diagram/export-inkscape` | POST | Accept `{ file: string }`, run `inkscape --export-latex` on the SVG, return path to `.pdf_tex` |
| `/api/diagram/export-xournal` | POST | Accept `{ file: string }`, run `xournalpp -i` on the `.xopp` to produce SVG/PNG, return path |
| `/api/diagram/capture-region` | POST | Run `grim -g "$(slurp)"` (or `flameshot gui --clipboard`), save to `./figures/`, return path |
| `/api/diagram/proxy` | GET | Fetch remote URL, inject content script, serve same-origin |
| `/api/filters` | GET | Scan `~/.pandoc/filters/` and `~/.pandoc/bin/`, return enabled/available |
| `/api/filters` | POST | Accept `{ enabled: string[] }`, write filter args to config |

Modified endpoints:

- `POST /api/save` — already exists; save gate calls this before diagram actions

### Cursor Injection

The app uses CodeMirror 6. The diagram modal needs access to the editor view to dispatch
insertion changes. This can be done via:

1. A ref to the CodeMirror `view` (exposed by `@uiw/react-codemirror`'s `onCreateEditor`
   callback)
2. The existing `window.__PANDOC_PREVIEW_STATE__` global can be extended with a
   `dispatchInsert` helper that the diagram modal calls

Injection format per tool:

| Tool | Injected Markup |
| --- | --- |
| Clipboard | `![](./figures/<uuid>.<ext>)\n` |
| FreeTikZ | ` ``` {.tex}\n\\begin{tikzpicture}\n...\n\\end{tikzpicture}\n``` \n` |
| quiver | ` ``` {.tex}\n\\begin{tikzcd}\n...\n\\end{tikzcd}\n``` \n` |
| Qtikz | ` ``` {.tex}\n\\begin{tikzpicture}\n% edit in ./figures/<stem>.tikz.tex\n\\end{tikzpicture}\n``` \n` |
| Tikzit | `\\ctikzfig{<stem>}\n` |
| Inkscape | `\\input{./figures/<stem>.pdf_tex}\n` |
| Xournal (filter) | ` ``` {.xournal}\n./figures/<stem>.xopp\n``` \n` |
| Xournal (capture) | `![](./figures/<stem>.png)\n` |

## Open Questions / Gaps

1. **quiver export DOM selector**: Still needs empirical verification.
   The export dialog in quiver needs to be inspected at runtime to find the correct CSS
   selector for the tikz-cd code element.
   This can be done in a spike.

2. **`tikzcd.lua` preamble dependency**: The filter references
   `/home/dzack/.pandoc/macros/preamble_common` which may not exist on clean machines.
   The portable version should either:
   - Generate a minimal preamble inline
   - Check for the file and degrade gracefully with a warning
   - Use `standalone` documentclass with minimal includes

3. **pdf2svg / pdflatex availability**: The tikzcd filter requires both `pdflatex` and
   `pdf2svg` on `$PATH`. The filter install step should check for these and warn if
   missing.

4. **quiver URL hash approach**: As an alternative to DOM scraping, quiver encodes the
   full diagram state in the URL fragment.
   The injected script could read `window.location.hash` and return it; the host app
   could reconstruct the diagram or forward the hash to the quiver "import from URL"
   feature. This is more stable across versions but less direct.

5. **Desktop app not found**: If Qtikz, Tikzit, Inkscape, or Xournal is not installed,
   the launch button should show a helpful error.
   The feature card currently assumes they're installed.

6. **Xournal lua filter design**: The `xournal.lua` filter needs to:
   - Intercept `CodeBlock` with class `.xournal`
   - Resolve the `.xopp` path relative to the document directory
   - Run `xournalpp -i` as an external command (pandoc lua's `os.execute` or
     `pandoc.pipe`)
   - Cache the SVG output to avoid re-rendering on every preview
   - Handle the case where `xournalpp` is not installed (degrade gracefully) The filter
     is app-owned and ships as a bundled default.

7. **Xournal XML format drift**: The `.xopp` format is compressed XML that may change
   across Xournal++ versions.
   The filter-based approach is robust to this since `xournalpp -i` is always the
   version that produced the file, but the filter should warn if the conversion fails.

8. **Region capture tool selection**: The screenshot approach needs a runtime check:
   - Wayland: use `grim + slurp` (bundled approach) or `flameshot gui` (if installed)
   - X11: use `flameshot gui` or `import` from ImageMagick
   - Fallback: prompt user to take screenshot manually and paste The capture endpoint
     should detect the display server and choose the appropriate tool.

## Verification

### Tests to Add

1. **Proxy endpoint**: Test that `/api/diagram/proxy?url=...` returns modified HTML with
   the injected content script present.

2. **FreeTikZ extract fixture**: Unit test the `postProcess` function that strips
   `\begin{document}` / `\end{document}` from a known fixture.

3. **Clipboard image write**: API test that `POST /api/figures` with image data creates
   a file in `./figures/` and returns the correct relative path.

4. **Desktop file creation**: Assert `POST /api/diagram/file` creates valid `.tex`,
   `.tikz`, `.svg`, and `.xopp` files in the expected location.

5. **Filter scan**: API test that `GET /api/filters` returns the expected filter list
   given a known directory structure.

6. **Filter toggle**: API test that `POST /api/filters` correctly updates the pandoc
   args in the config.

7. **Injection render**: Create a markdown file with injected tikzpicture raw block,
   render through pandoc with the portable tikzcd filter, assert `<img class="tikz">`
   appears in the HTML output.

8. **Save gate behavior**: Browser test that clicking any diagram action while the file
   is a temp file triggers the save-as dialog first.

### Acceptance Criteria

- [ ] Filter config modal scans `~/.pandoc/filters/` and shows checkbox list
- [ ] Toggling filters persists to `pandoc-preview.toml` and takes effect on next render
- [ ] Portable `tikzcd.lua` filter is installed to `~/.pandoc/filters/` on first launch
- [ ] Default filters ship in `src/server/filters/`
- [ ] Web tools (FreeTikZ, quiver) open in iframes with floating "Export" button overlay
- [ ] Export button extracts code via CSS selector and posts to host via postMessage
- [ ] Injected code appears at cursor position in the editor
- [ ] Clipboard image: save-gate → clipboard read → file in `./figures/` → `![](...)`
  insert
- [ ] Qtikz: save-gate → file created → Qtikz launched → template injected
- [ ] Tikzit: save-gate → file created → Tikzit launched → `\ctikzfig{}` injected
- [ ] Inkscape: save-gate → SVG created in `./figures/` → Inkscape launched → export to
  PDF+LaTeX → `\input{}` injected
- [ ] Xournal: save-gate → `.xopp` created in `./figures/` → xournalpp launched
- [ ] Xournal filter injection: `` ``` {.xournal}\n./figures/<stem>.xopp\n``` ``
  inserted at cursor
- [ ] Xournal screenshot capture: region capture via grim+slurp saves to `./figures/` →
  `![](...)` injected
- [ ] `xournal.lua` bundled filter converts `.xopp` → SVG at render time
- [ ] `./figures/` created automatically relative to saved file
- [ ] All diagram options gated by save-as when file is temp
- [ ] Injected tikz content renders as SVG in preview (with filter enabled)

## TDD Guardrails

- RED first for each sub-outcome: no implementation work begins for clipboard injection,
  save gating, filter scanning, desktop-launch flows, or iframe export flows until a
  failing test exists for that exact owned behavior.
- Required test order:
  - first failing browser test for the save gate and cursor insertion path
  - then failing API tests for concrete filesystem boundaries such as figure writes or
    deterministic file creation
  - then failing integration tests for renderer-visible output when a bundled filter is
    involved
- No production code may be written ahead of the failing proof.
  If exploration code is written to understand an approach, discard it and restart from
  tests.
- Tests must use real filesystem writes, real browser flows, and real command execution
  where the repository owns the interlock.
  No mocks, no `xfail`, no `skip`.
- Assertions must prove owned behavior: exact inserted markdown, exact disk
  path/content, exact workspace-relative figure location, exact save-as gating, and
  exact preview output when the configured renderer/filter path succeeds.
- GREEN means the smallest code change that makes the newly failing test pass; REFACTOR
  is allowed only after the focused test and the relevant suite stay green.
