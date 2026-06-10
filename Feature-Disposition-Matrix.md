# Feature Disposition Matrix

## Active core requirements

- Tauri desktop app.
- Browser-based plain-text editor.
- CodeMirror editor surface.
- Optional Firenvim text editing limited to textarea editing.
- Live preview through configured renderer command.
- Raw `render_command` as source of truth.
- Centralized Pandoc assets in `~/.pandoc/`.
- Internal Git-backed recovery store.
- Save equals Git commit for tracked files.
- Backend autosave commits temporary/untracked buffers.
- Save gate for durable-context actions.
- Global figures directory.
- Server-side Pandoc/TeX/filter TikZ rendering.
- Deep FreeTikZ/quiver integration.
- Supported desktop diagram tools: Qtikz, Tikzit, Inkscape, xournalpp, ipe.
- Hover-to-edit through template/filter tagging and `postMessage`.
- Structured IPC success/failure.
- Fail-fast runtime behaviour.
- Dense real Tauri workflow tests.

## Explicit non-goals

- Cross-platform support.
- Multi-user support.
- Remote collaboration.
- Horizontal scaling.
- Hosted deployment.
- Security hardening.
- XSS prevention.
- HTML sanitization.
- Preview sandboxing.
- Dynamic port allocation for security.
- Generic Git client UI.
- Full file manager.
- Per-document figures directories.
- In-browser TikZ rendering.
- Express preview server.

## Dropped or banned features

- drawio.
- xournal.
- TikZjax.
- Browser-mode feature proof.
- IPC mocks.
- Source-policing tests.
- `@ts-nocheck`.
- `as any`.
- Silent fallbacks.
- Runtime defaults.
- Success-shaped errors.
- Compatibility shims after replacement.
- Feature flags preserving abandoned paths.

## Standard behaviours assumed but not specified

The application is expected to have ordinary editor affordances such as opening, saving, keyboard shortcuts, a menu bar, recent files, and user-visible dialogs. These are not project-defining requirements except where they interact with temporary files, Git recovery, renderer invocation, plugin execution, diagrams, figures, or explicit failure semantics.
