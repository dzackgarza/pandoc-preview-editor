# pandoc-preview TODO

## Implemented

- **Editor + Preview**: CodeMirror editor with 400ms debounced pandoc render into iframe
  (`src/client/App.tsx`, `src/server/render.ts`)
- **CLI file loading**: `[file]` argument reads content, inlines via
  `window.__INITIAL_CONTENT` (`src/server/cli.ts`)
- **Save**: `POST /api/save`, Ctrl+S keymap, File menu (`src/server/index.ts`,
  `src/client/App.tsx`)
- **New File**: `POST /api/files/new` creates untitled markdown in workspace
- **Explorer drawer**: Collapsible file tree with lazy directory loading, text-like
  filtering, ignore rules (`ExplorerDrawer` in `App.tsx`, `/api/files`,
  `/api/files/content`, `src/server/workspace.ts`)
- **Plugin system**: TOML manifests, category-grouped menu, spawn-based execution with
  variable interpolation (`src/server/plugins.ts`,
  `src/server/plugins/export-html.toml`)
- **Status bar**: Render status, duration (ms), save state, plugin state, line count
  (`StatusCluster` in `App.tsx`)
- **Stale render prevention**: Version-based discard of late render responses
- **Plugin save-before-run**: Removed unnecessary `resolveInside`/`statSync` guards from
  plugin endpoint; manager now saves markdown to tracked path before executing CLI
  commands
- **Toast notifications**: Success/error toasts for plugin execution with motion
  animation and manual dismiss (`Toasts` component in `App.tsx`)
- **Tests**: `file.spec.ts` (7 tests), `render.spec.ts` (10 tests), `e2e.spec.ts` (16
  tests), `plugins.spec.ts` (3 tests), `math.spec.ts` (2 tests),
  `editor-height.spec.ts`, `user-behaviors.spec.ts`

## Partly Done

- **Responsiveness**: Debounce and version checks done.
  Candidate enhancements (cancel in-flight render, worker rendering) not done — see
  `.agents/plans/responsiveness-and-efficiency.md`

## Not Done

- **Refresh button** — `.agents/plans/refresh-button.md`
- **Last saved timestamp** — `.agents/plans/last-saved-timestamp.md`
- **Settings dropdown / configurable pandoc command** —
  `.agents/plans/settings-dropdown-pandoc-command.md`
- **HTML template rendering QA** — `.agents/plans/html-template-rendering.md`
- **AMSthm rendering tests** — `.agents/plans/amsthm-rendering.md`
- **Pandoc filters testing** — `.agents/plans/pandoc-filters-testing.md`
