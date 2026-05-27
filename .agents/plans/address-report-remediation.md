# Remediation Plan: REPORT.md Findings

## Goal

Fix the five code-quality issues identified in REPORT.md.
These are genuine maintainability, correctness, and dependency-use problems — not
performance concerns.

## Current State Assessment

| Finding | Status |
| --- | --- |
| God Objects (App.tsx monolithic) | Partially remediated (modals extracted, but App.tsx is 791 lines with mixed concerns) |
| Reinventing fzf | Partially remediated (async dir scan exists, but sync stat calls remain + app still hand-rolls file finding) |
| Timing Assertion Theater | File still present (`src/tests/responsiveness.spec.ts` + `slow-renderer.mjs`) |
| Regex Against Semantic Formats | Present, with a test in `architectural-regression.spec.ts` |
| Autosave Network Spam | Backup endpoint plus 500ms debounce still present |

* * *

## Finding 1: God Objects — Extract Hooks From App.tsx

**Problem**: App.tsx (791 lines) owns render orchestration, save/persist state machine,
file management, clipboard images, plugin dispatch, citation fetching, keyboard
shortcuts, and diagnostics rendering.
All as inline callbacks and JSX. This is a maintainability issue — changing one concern
risks breaking unrelated ones.

**Approach**: Extract stateful logic into custom hooks, keeping App.tsx as a thin
orchestrator that wires hooks to components.
Do NOT make the render flow more complex or add abstractions — just relocate existing
code into well-named files.

**Proposed hooks**:

| Hook | Contents from App.tsx | Est. LOC removed |
| --- | --- | --- |
| `useRender` | `doRender`, `renderImmediate`, `scheduleRender`, `clearRenderTimer`, `renderVersion` ref, `debounceTimer` ref, `previewHtml`/`status`/`durationMs`/`diagnostics` state, the render `useEffect` | ~90 |
| `useSave` | `persistMarkdown`, `ensureRealFile`, `ensureBufferSafeToReplace`, `saveCurrent`, `saveCurrentAs`, `promptForSavePath`, `saveAsResolveRef`, `saveAsDialogOpen`/`mode` state, `saveState`/`savedAt` state, `handleSaveAsSubmit`/`Cancel` | ~120 |
| `useFileManagement` | `openFile`, `createNewFile`, `currentFile`/`isTempFile`/`workspaceRoot` state, `updateMarkdown` | ~50 |
| `useClipboardImage` | `uploadImageAndInsert`, `insertClipboardFigure`, `blobToBase64`, the paste `useEffect` | ~90 |
| `usePlugins` | `plugins` state, `runPluginAction`, plugin fetch `useEffect`, `pluginState` | ~70 |
| `useKeyboard` | The keydown `useEffect` (Ctrl+P, Ctrl+Shift+S, Ctrl+Shift+C) | ~30 |

**Remaining in App.tsx**: ~340 lines — imports, types, JSX layout, `TopMenuBar`/dialog
props wiring, minor glue.
This is the right scope for a top-level component.

**Helper files to move out of App.tsx**:

- `blobToBase64` → `src/client/lib/file.ts`

- `errorDocument` + `escapeHtml` → `src/client/lib/html.ts`

**Files**:

- `src/client/App.tsx` — strip down to orchestrator

- `src/client/hooks/useRender.ts` — new

- `src/client/hooks/useSave.ts` — new

- `src/client/hooks/useFileManagement.ts` — new

- `src/client/hooks/useClipboardImage.ts` — new

- `src/client/hooks/usePlugins.ts` — new

- `src/client/hooks/useKeyboard.ts` — new

- `src/client/lib/file.ts` — new (blobToBase64)

- `src/client/lib/html.ts` — new (errorDocument, escapeHtml)

**Pre-existing components NOT to touch**: TopMenuBar, ExplorerDrawer, EditorPane,
PreviewPane, StatusCluster, FileSelectorDialog, QuickOpenDialog, SettingsDialog,
FilterSettingsModal, DiagramModal, Toaster, PaneHeader, SaveAsDialog — already modular.

**Risk**: Low. Pure relocation of existing code.
No behavioral changes.
Verify with existing test suite.

* * *

## Finding 2: Reinventing fzf — Delegate File Finding to System Tools

**Problem**: The quick-open palette (`/api/files/quick-open`) recursively scans the
workspace on every keystroke.
While `collectMarkdownFilesAsync` is async, the `recentEntries` filter still calls
`existsSync`/`statSync` synchronously (lines 377-378 of index.ts).
More fundamentally, the app implements its own file-finding dialog
(`QuickOpenDialog.tsx` + API endpoint) rather than delegating to `fzf` or `dmenu`.

**Approach**: Replace the quick-open API + React dialog with a subprocess call to `fzf`
(or `dmenu` on systems without fzf).

**What changes**:

- **Remove** `GET /api/files/quick-open` endpoint (lines 363-399 of index.ts)

- **Remove** `collectMarkdownFilesAsync` (lines 1121-1147 of index.ts)

- **Remove** `quickOpenEntry`, `quickOpenMatches`, `QuickOpenEntry` type from server

- **Remove** `src/client/components/QuickOpenDialog.tsx` and its tests

- **Add** `POST /api/files/fzf-open` endpoint that:

  1. Takes `{ workspaceRoot: string }`

  2. Spawns `fzf` with `--print-query` or equivalent in the workspace directory

  3. Returns the selected file path

- **Update client side**: Ctrl+P calls the new endpoint instead of opening a React
  dialog

**Alternative**: If fzf/dmenu are not always available, keep the endpoint but remove the
sync stat calls and cache the directory listing.

**Files**:

- `src/server/index.ts` — replace quick-open endpoint, remove helper functions

- `src/client/App.tsx` — replace dialog open with endpoint call

- `src/client/components/QuickOpenDialog.tsx` — delete

- `src/tests/user-behaviors.spec.ts` — update/remove quick-open tests

- `src/tests/architectural-regression.spec.ts` — update/remove quick-open API test

**Testing**:

- E2E: verify Ctrl+P spawns fzf and opens the selected file

- Unit: test the endpoint returns correct path from fzf

**Risk**: Medium. fzf may not be installed on all systems the codebase targets.
But per the “bespoke software” principle, fail loudly if fzf is missing.

* * *

## Finding 3: Timing Assertion Theater — Delete Invalid Tests

**Problem**: `src/tests/responsiveness.spec.ts` asserts timing expectations
(`expect(totalTime).toBeLessThan(2500)`). The philosophy is explicit: no test should
ever assert timing information.
This is a hallucinated benchmark.

**Approach**: Delete the file and its helper.

**Files**:

- `src/tests/responsiveness.spec.ts` — delete

- `src/tests/slow-renderer.mjs` — delete

**Testing**: The test suite should still pass.
No replacement needed — the test was proving nothing about correctness.

**Risk**: None.

* * *

## Finding 4: Regex Against Semantic Formats — Replace With Pandoc Lua Filter

**Problem**: `withPreviewAssetUrls` (index.ts:1199-1209) uses a regex to rewrite `src=`
attributes in HTML output.
This is regex against a format produced by a semantic parser (pandoc).
The correct approach is to use the semantic tool at its own level: a pandoc Lua filter
operating on the AST before HTML is generated.

Additionally, the existing e2e test oracle (`torture.expected-body.html`) asserts on
byte-exact HTML formatting (whitespace, indentation, self-closing tag syntax).
This is test slop per the skill: “tests that assert on strings, formatting, whitespace,
or byte-level output are a HUGE sign of slop.”

**Approach**: Delete `withPreviewAssetUrls` entirely.
Write a pandoc Lua filter that rewrites image src paths at the AST level.
The filter is always-on (built-in), not user-toggleable.

**TDD Process** (per the skill’s “Findings Are Flags” section):

1. **Fix test slop FIRST** — The e2e torture document test asserts on byte-exact HTML
   formatting. Replace the oracle-based exact match with a semantic assertion that
   verifies the preview iframe body content renders correctly using Playwright’s
   semantic matchers (`.toHaveText()`, `.toHaveAttribute()`, `.toBeVisible()`). The
   proof is: content entered through the app appears in the preview exactly as the
   configured renderer would emit it, not that byte strings match.

2. **Add regression tests** — Verify the current `withPreviewAssetUrls` behavior
   (relative src rewriting, protocol/anchor/root preservation) is captured in tests.
   These already exist in `architectural-regression.spec.ts`.

3. **Add wrong implementation** — Replace `withPreviewAssetUrls` with a no-op (return
   html unchanged). Confirm the regression tests turn RED for the right reason (image src
   paths are not rewritten).

4. **Implement the fix** — Write the Lua filter and integrate it into the render
   command. Remove `withPreviewAssetUrls`. Confirm all tests GREEN.

**Lua Filter** (`~/.pandoc/filters/preview-assets.lua`):
```lua
function Image(el)
  if not el.src:match('^[A-Za-z][A-Za-z%d+.-]*:') and not el.src:match('^/') then
    el.src = '/api/preview-assets?path=' .. el.src
  end
  return el
end
```

**Integration**: The server constructs the pandoc command from `config.renderCommand`
and adds `--lua-filter` flags for enabled filters.
Add this filter as a built-in (always prepended/appended to the filter list, not
user-toggleable).

**Files**:

- `src/server/index.ts` — delete `withPreviewAssetUrls`, add built-in filter to render
  command construction

- `src/tests/e2e.spec.ts` — replace byte-exact oracle comparison with semantic
  assertions

- `src/tests/architectural-regression.spec.ts` — update tests (no more
  `withPreviewAssetUrls`, test filter behavior instead)

**Risk**: Low. The Lua filter operates on pandoc’s own AST, so it cannot miss edge cases
that regex or HTML parsers could.
The browser preview behavior is identical.

* * *

## Finding 5: Autosave Backup Pattern (Lowest Priority)

**Problem**: The 500ms debounce POST to `/api/backup` on temp-file edits creates network
chatter. Currently uses `writeFileSync` on the server side.

**Assessment**: This is a pre-emptive optimization concern unless there is a
user-reported bug.
The backup mechanism exists for crash recovery on unsaved temp files —
losing even a few seconds of work is worse than “excessive” chatter on what is a
localhost POST.

**Recommended action**: Leave as-is unless user experiences actual issues.
The finding is noted but not actionable per the core philosophy.

**If user wants to address anyway**: Replace the network backup with `localStorage`
writes in the client, removing the need for the `/api/backup` endpoint entirely.

**Files**: None unless user decides to proceed.

* * *

## Implementation Order

Per the skill’s “Findings Are Flags” section: fix test slop FIRST, then add regression
tests, then wrong implementation (confirm red), then refactor, then confirm green.

1. **Finding 3** (delete timing tests) — trivial, done (committed `ffa1449`)

2. **Finding 4** (regex → pandoc Lua filter) — follow TDD order: a. Fix brittle e2e
   oracle test → semantic assertions b. Regression tests already exist
   (architectural-regression) c. Wrong implementation (no-op) → confirm red d. Lua
   filter + remove withPreviewAssetUrls → green

3. **Finding 1** (extract hooks from App.tsx) — largest LOC change, provides most
   maintainability value

4. **Finding 2** (fzf integration) — medium scope, may involve UI changes

5. **Finding 5** — defer unless user reports an issue

## Verification

After each finding:

- Run `just` (or whatever the test recipe is) to confirm no regressions

- Read the changed files to confirm the diff is surgical

- Commit with a message referencing the REPORT.md finding

## Files Summary

| Action | Files |
| --- | --- |
| Delete | `src/tests/responsiveness.spec.ts`, `src/tests/slow-renderer.mjs`, `src/client/components/QuickOpenDialog.tsx` |
| Modify | `src/client/App.tsx`, `src/server/index.ts` |
| Create | `src/client/hooks/useRender.ts`, `src/client/hooks/useSave.ts`, `src/client/hooks/useFileManagement.ts`, `src/client/hooks/useClipboardImage.ts`, `src/client/hooks/usePlugins.ts`, `src/client/hooks/useKeyboard.ts`, `src/client/lib/file.ts`, `src/client/lib/html.ts` |
| Add | `filters/preview-assets.lua` (pandoc Lua filter) |
