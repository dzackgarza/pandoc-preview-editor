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
  variable interpolation and bundled HTML/LaTeX/PDF export plugins
  (`src/server/plugins.ts`, `src/server/plugins/*.toml`)
- **Refresh button**: toolbar and View menu action for immediate re-render
- **Last saved timestamp**: status bar timestamp after successful app-owned saves
- **Renderer config regression tests**: wrapper-based tests prove configured renderer
  invocation and stderr/nonzero exit handling without app-owned renderer flags
- **Status bar**: Render status, duration (ms), save state, plugin state, line count
  (`StatusCluster` in `App.tsx`)
- **Stale render prevention**: Version-based discard of late render responses
- **Plugin save-before-run**: Removed unnecessary `resolveInside`/`statSync` guards from
  plugin endpoint; manager now saves markdown to tracked path before executing CLI
  commands
- **Toast notifications**: Success/error toasts for plugin execution with motion
  animation and manual dismiss (`Toasts` component in `App.tsx`)
- **Tests**: API and browser suites cover render, file workflows, plugins, renderer
  config, math, editor height, and user behavior.

## Partly Done

- **Responsiveness**: Debounce and version checks done.
  Candidate enhancements (cancel in-flight render, worker rendering) not done — see
  `.agents/plans/responsiveness-and-efficiency.md`

## Not Done

- **Renderer diagnostics UI** — richer stderr/nonzero-exit display beyond the current
  error document, if needed.
- **Centralized Pandoc template/filter QA** — optional manual QA around
  `~/.pandoc/templates/` and `~/.pandoc/filters/`; app tests should stay
  renderer-agnostic.
