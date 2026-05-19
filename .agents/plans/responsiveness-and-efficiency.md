# Feature: Responsiveness and Rendering Efficiency

## Problem

Every keystroke or buffer change in nvim triggers the full render pipeline
synchronously:

1. nvim plugin sends full buffer via raw TCP POST
2. Server calls `spawnSync('pandoc', ..., timeout: 5000)` — blocks the event loop
3. Server broadcasts HTML over WebSocket
4. Client sets `iframe.srcdoc = html` — tears down and rebuilds the entire iframe
   document

This causes three distinct problems:

- **Event loop blocking**: `spawnSync` blocks the Node.js event loop, delaying WebSocket
  messages (PTY output), HTTP responses, and timer callbacks for the duration of pandoc
  (~50-200ms typical, 5000ms timeout worst case).
- **Stale renders**: If the user types faster than pandoc can render, pandoc finishes
  with old content. No version check — client displays the last-completed render, not the
  latest content.
- **iframe flash/scroll loss**: `srcdoc = html` destroys and recreates the entire iframe
  DOM. Scroll position resets.
  Any JS state (MathJax caches, syntax highlighting) is lost.

These are well-known problems in other markdown preview tools, documented in the
research below.

## Evidence from Other Projects

Citations use `: ` format — each entry starts with the source URL and the specific
evidence found there.

### VS Code Markdown Preview

**Source**: https://github.com/microsoft/vscode/issues/136255 Finding: "VS Code's
markdown preview updates lives as the user types.
To support this, we currently re-render the entire webview."
They identified the same problems: scroll position loss, resources reloaded on every
update, scripts needing re-initialization.
v1.63 migrated to incremental DOM updates with a custom `vscode.markdown.updateContent`
event to signal scripts.

**Source**: https://github.com/microsoft/vscode/issues/138669 Finding: The rendering
frequency is "hard-coded in vscode to 300ms". Users requested configurability.
The proposed better solution was incremental DOM updates (from #136255) rather than
making the timeout configurable.

**Source**: https://github.com/microsoft/vscode/issues/72671 Finding: Rapid typing
causes the preview to go permanently out of sync — the final keystrokes don't trigger a
render. Root cause: no request coalescing with version tracking.
Two failure points: scheduling in `doUpdate` and webview content updates racing each
other.

### MacDown

**Source**: https://github.com/MacDownApp/macdown/pull/1362 Finding: Original used
`loadHTMLString` on every content change, replacing the entire WebView — caused visible
white flash between old content disappearing and new content appearing.
(Same as `srcdoc = html`.)

Fix: in-place `document.body.innerHTML` replacement via
`stringByEvaluatingJavaScriptFromString:`. Only `<body>` replaced; `<head>`
(stylesheets, scripts) stays intact.
After DOM swap, manually re-triggers JS libs: `Prism.highlightAll()`,
`MathJax.Hub.Typeset()`, `hljs.highlightElement()`. Full page reloads only on initial
load or base URL changes.

The PR author notes the previous approach was abandoned because "JavaScript libraries
like MathJax and Prism lost their rendering state after the DOM swap."

### Zed Editor

**Source**: https://github.com/zed-industries/zed/pull/48633 Finding: Uses 200ms
debounce for editor-triggered preview updates.
Has a separate non-debounced task slot for UI interactions (checkbox clicks) so those
feel instant. The bug was that the debounced editor task was replacing the non-debounced
task, making clicks feel sluggish.

### Obsidian

**Source**: Obsidian API docs (MarkdownPreviewView, MarkdownRenderer):
- `MarkdownPreviewView.rerender(full)` — supports partial vs full re-rendering
- `MarkdownRenderer.render()` renders to an existing DOM element (not iframe)
- Component lifecycle with `addChild`/`removeChild` for rendered content
- `MarkdownPreviewRenderer.registerPostProcessor()` for post-processing hooks

**Source**: blacksmithgu/obsidian-dataview plugin, `src/ui/lp-render.ts`:
- Live Preview uses CodeMirror 6 `ViewPlugin` with `DecorationSet`
- Iterates only `view.visibleRanges` — renders only visible content
- Checks `editorLivePreviewField` to gate decoration rendering
- Rebuilds decorations on `docChanged`, `selectionSet`, or `viewportChanged`
- On `docChanged`, maps existing decorations via `this.decorations.map(update.changes)`
  rather than rebuilding from scratch

### Pulsar (Atom fork)

**Source**: https://github.com/pulsar-edit/pulsar/pull/984 Finding: "The main problem
with markdown-preview is that the entire contents of the preview pane are replaced
whenever the content changes.
You don't notice it because most of the content is the same, but it's still a lot of
work."

Their fix: introduced morphdom for DOM diffing so each re-render alters the existing DOM
as little as possible.
Caches syntax-highlighted `TextEditor` instances across renders so code blocks don't get
destroyed and recreated.
Loading indicator shown during render.

The PR author identifies the root performance problem: "emptying the element and
starting over every time" — which is the same pattern as `srcdoc = html`.

### OverType (WYSIWYG Markdown)

**Source**: https://github.com/panphora/overtype/blob/main/ARCHITECTURE.md Finding:
Transparent textarea overlaid on rendered HTML. Uses synchronous innerHTML replacement
on input. Debounce strategy: 50ms for selection changes, 100ms throttle for stats
updates, sync for preview.
Line-level parsing limits scope of re-renders.
Uses "sanctuary pattern" to prevent re-parsing unchanged content.

### Typora

**Source**: https://airouter.me/article/typora (Chinese architecture analysis) Finding:
Self-developed Markdown parsing and rendering engine ("自研引擎"), not built on marked,
remark, or any existing library.
Renders span elements ("行内元素") immediately on typing, block elements on completion.
Hybrid view shows raw Markdown when cursor is near formatted text, hides it otherwise.
Built on Electron with Chromium + Node.js.

### General Pattern from Web Frameworks

**Source**: https://github.com/rainlab/blog-plugin/issues/502 Finding: October CMS blog
plugin used 250ms debounce for server-side markdown preview AJAX. Concern: 200
keystrokes/min = 200 AJAX requests/min without debounce.
Potential to be interpreted as DDoS.

**Source**: https://github.com/remarkjs/react-markdown/issues/459 Finding:
Recommendation to use lodash debounce as the standard solution for smooth rendering.
Notes that parsing/processing becomes "computationally expensive given enough text"
regardless of the library used.

## Architecture Options

### Option A: Server-Side Coalescing + Async Pandoc (Minimum Viable)

Keep the existing pipeline structure but fix the blocking and staleness:

1. Replace `spawnSync` with `spawn` + stdin pipe (pandoc accepts stdin)
2. Add request coalescing: if a new buffer-update arrives while pandoc is running, stash
   it. When pandoc finishes, check if a stashed request exists — if so, restart with that
   content instead of broadcasting stale HTML.
3. Add version counter: each buffer-update gets a sequence number.
   Broadcast only if the completed render matches the latest sequence.
4. Increase nvim-side debounce from 200ms to 300-400ms to reduce server load.

**Files changed**: `server/index.ts` (buffer-update handler), `server/render.ts`
**Estimated complexity**: ~50 lines **What it fixes**: event loop blocking, stale
renders. Does NOT fix iframe flash/scroll loss.

### Option B: In-Place DOM Replacement (iframe fix)

Replace `iframe.srcdoc = html` with in-place body replacement inside the iframe,
following MacDown's approach:

1. Keep the iframe loaded with a base HTML document (stylesheets, scripts, MathJax
   config already in `<head>`)
2. On preview update, extract `<body>` content from pandoc's output
3. Inject it via `iframe.contentDocument.body.innerHTML = bodyHtml`
4. Re-trigger MathJax/Prism via `eval` in the iframe context

**Files changed**: `web/PreviewPane.ts` **Estimated complexity**: ~30 lines **What it
fixes**: iframe flash, scroll loss (need to save/restore scrollTop), JS lib re-init
(need to re-trigger).
**Caveat**: Still does a full body replacement — DOM state for interactive elements is
lost. `srcdoc` origin restrictions prevent cross-origin scripting (works only
same-origin).

### Option C: Div-Based Preview (Eliminate Iframe)

Replace the iframe with a styled `<div>` that renders HTML directly from pandoc:

1. Parse pandoc's standalone HTML output, or configure pandoc to output a fragment
   (`--to html` without `--standalone`, or add a wrapper div)
2. Set `div.innerHTML = bodyHtml` directly
3. Preserve scroll position by saving/restoring `scrollTop`
4. Run JS for syntax highlighting / math in the main page context

**Files changed**: `web/index.html`, `web/PreviewPane.ts`, `server/render.ts`
**Estimated complexity**: ~60 lines + CSS changes **What it fixes**: iframe flash,
scroll loss, JS library re-init.
**Caveat**: Pandoc with `--standalone` outputs a full HTML document.
Would need to strip the `<html>/<head>/<body>` wrapper, or run pandoc without
`--standalone` and import styles separately.
CSS isolation is lost (page styles can leak into preview content).

### Option D: DOM Diffing (Minimal DOM Churn)

Build on Option B or C but use morphdom or similar to diff old HTML against new HTML and
apply only minimal changes:

1. Keep previous rendered body HTML
2. Compute diff between old and new HTML using morphdom (~5KB)
3. Apply only changed nodes to the DOM
4. Preserves scroll position naturally (DOM tree stays mostly intact)
5. Preserves interactive state (expanded details, focused elements)

**Files changed**: `web/PreviewPane.ts`, add `morphdom` dependency **Estimated
complexity**: ~40 lines + morphdom install **What it fixes**: everything in Option B/C
plus minimal DOM churn.
**Caveat**: Requires tracking previous HTML. morphdom edge cases with special elements
(SVG, math).

## Recommended Approach

**Phase 1** (high impact, low risk): Options A + B
- Server coalescing + async pandoc to stop blocking and stale renders
- In-place body replacement to stop iframe flash

**Phase 2** (medium effort): Upgrade B to D (morphdom)
- Minimal DOM churn preserves interactive widget state

**Phase 3** (optional): Evaluate Option C (div-based)
- Only if iframe sandboxing or origin issues become limiting

## Files Changed (Phase 1)

| File | Change |
| --- | --- |
| `server/render.ts` | Replace `spawnSync` with async `spawn` + stdin pipe |
| `server/index.ts` | Add request coalescing + version counter in buffer-update handler |
| `web/PreviewPane.ts` | Replace `srcdoc` with `contentDocument.body.innerHTML` + scroll save/restore |
| `web/index.html` | Optional: add script in iframe to re-trigger MathJax/Prism |

## Testing / Validation

1. Rapid typing test: type 20 characters in 2 seconds — verify at most 2 pandoc
   invocations (not 20)
2. Stale render test: start pandoc, type more while it runs — verify preview shows final
   content, not intermediate
3. Scroll test: scroll preview partway, trigger render — verify scroll position is
   preserved
4. Flash test: visual inspection — no white flash between renders
5. Blocking test: start pandoc with large doc (~5000 lines), verify WebSocket messages
   (PTY output) still flow during render
6. Sync test: verify MathJax/Prism still renders after DOM update

## Non-Goals

- Not doing incremental markdown parsing (pandoc cannot do this)
- Not doing visible-only rendering (pandoc must render full document)
- Not building a WYSIWYG editor inside nvim
- Not caching pandoc output across renders (content always changes)

## Open Questions

1. Should `pandoc` be kept as a long-lived subprocess (spawn once, pipe stdin
   repeatedly) rather than spawning per request?
   This avoids ~50ms process spawn overhead but adds complexity around crash recovery.
2. What is the actual scroll restore strategy?
   Save `scrollTop` before body replacement, restore after.
   But if content length changed, the old scroll position maps to a different location.
3. For Option C (div-based): what CSS isolation strategy?
   Shadow DOM? Scoped styles?
   Iframe currently provides perfect isolation.
4. Should the nvim plugin's timer (200ms) be adjusted to match server- side debounce, or
   kept independent as a first-line filter?
