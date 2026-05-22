# pandoc-preview TODO

## Implemented

- **Editor + Preview**: CodeMirror editor with 400ms debounced pandoc render into iframe
  (`src/client/App.tsx`, `src/server/render.ts`)
- **CLI file loading**: `[file]` argument reads content, inlines via
  `window.__INITIAL_CONTENT` (`src/server/cli.ts`)
- **Save**: `POST /api/save`, Ctrl+S keymap, File menu (`src/server/index.ts`,
  `src/client/App.tsx`)
- **New File**: prompts for a target path and records it as pending; the first app-owned
  save creates the real file with the current textarea content
- **Temp backup recovery**: no-arg launches keep a temp-backed recovery buffer while
  Save, Plugin, Open, and New gate through a real user-chosen file path before
  path-dependent work
- **Explorer drawer**: Collapsible file tree with lazy directory loading, text-like
  filtering, ignore rules (`ExplorerDrawer` in `App.tsx`, `/api/files`,
  `/api/files/content`, `src/server/workspace.ts`)
- **Quick Open palette**: Ctrl+P/Cmd+P opens a markdown-only workspace search, supports
  keyboard selection, tracks recent opens, and opens through the same save-gated file
  identity path as Explorer (`QuickOpenDialog` in `App.tsx`,
  `/api/files/quick-open`)
- **Zotero citation insertion**: Insert menu, toolbar button, and Ctrl/Cmd+Shift+C call
  the server-side Better BibTeX CAYW proxy and insert the returned Pandoc citation at
  the CodeMirror cursor (`/api/zotero/cite`)
- **Save-gated figure insertion**: Insert menu and toolbar action read an image from the
  browser clipboard, require a real saved document path, create `./figures/` beside the
  document, write the image there, and insert the markdown reference at the CodeMirror
  cursor. Preview rewrites relative image `src` values through `/api/preview-assets`
  so the iframe displays local document assets without direct filesystem access
  (`/api/figures/assets`)
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

## Implemented

- **Editor + Preview**: CodeMirror editor with 400ms debounced pandoc render into iframe
  (`src/client/App.tsx`, `src/server/render.ts`)
- **CLI file loading**: `[file]` argument reads content, inlines via
  `window.__INITIAL_CONTENT` (`src/server/cli.ts`)
- **Save**: `POST /api/save`, Ctrl+S keymap, File menu (`src/server/index.ts`,
  `src/client/App.tsx`)
- **New File**: prompts for a target path and records it as pending; the first app-owned
  save creates the real file with the current textarea content
- **Temp backup recovery**: no-arg launches keep a temp-backed recovery buffer while
  Save, Plugin, Open, and New gate through a real user-chosen file path before
  path-dependent work
- **Explorer drawer**: Collapsible file tree with lazy directory loading, text-like
  filtering, ignore rules (`ExplorerDrawer` in `App.tsx`, `/api/files`,
  `/api/files/content`, `src/server/workspace.ts`)
- **Quick Open palette**: Ctrl+P/Cmd+P opens a markdown-only workspace search, supports
  keyboard selection, tracks recent opens, and opens through the same save-gated file
  identity path as Explorer (`QuickOpenDialog` in `App.tsx`,
  `/api/files/quick-open`)
- **Zotero citation insertion**: Insert menu, toolbar button, and Ctrl/Cmd+Shift+C call
  the server-side Better BibTeX CAYW proxy and insert the returned Pandoc citation at
  the CodeMirror cursor (`/api/zotero/cite`)
- **Save-gated figure insertion**: Insert menu and toolbar action read an image from the
  browser clipboard, require a real saved document path, create `./figures/` beside the
  document, write the image there, and insert the markdown reference at the CodeMirror
  cursor. Preview rewrites relative image `src` values through `/api/preview-assets`
  so the iframe displays local document assets without direct filesystem access
  (`/api/figures/assets`)
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
- **Responsiveness**: Debounce, version checks, and cancel in-flight renders. Worker
  rendering is a future candidate — see `.agents/plans/responsiveness-and-efficiency.md`
- **Tests**: API and browser suites cover render, file workflows, plugins, renderer
  config, math, editor height, and user behavior.

## Not Done

- **Renderer diagnostics UI** — richer stderr/nonzero-exit display beyond the current
  error document, if needed.
- **Centralized Pandoc template/filter QA** — optional manual QA around
  `~/.pandoc/templates/` and `~/.pandoc/filters/`; app tests should stay
  renderer-agnostic.
- **Deprioritized active cards** — CriticMarkup GUI, agent chat, TikZJax, and
  renderer/filter settings are not next. They are either large, speculative,
  editor-behavior-heavy, or too close to renderer ownership for the current app
  boundary.
