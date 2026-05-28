# pandoc-preview TODO

## File Integrity Implementation (Active Branch: feature/file-integrity)

- [ ] **Task 1: Refactor Save Endpoints for Atomicity**
  - Implement safe atomic writes via a temporary sibling file (e.g., `.${filename}.tmp.[uuid]`) in the same directory.
  - Sync the file descriptor to physical disk before renaming.
  - Atomically rename the temporary file over the target destination using `fs.renameSync`.
- [ ] **Task 2: Implement File Fingerprinting & Conflict Prevention**
  - Cache modification time (`mtimeMs`) and content hash upon opening or successfully saving a file.
  - Verify if the disk version has been modified by an external process before writing.
  - Halt saving and return a conflict error if an external change is detected, enabling user resolution.

## Active (Main Backlog)

- **Obsidian callout → amsthm** — Convert Obsidian callouts to amsthm environments.
- **Centralized Pandoc template/filter QA** — Optional manual QA around `~/.pandoc/templates/` and `~/.pandoc/filters/`; app tests stay renderer-agnostic.

## Completed

- **TikZJax rendering** — ````tikz` code blocks render as SVG in the preview via `@jhuix/tikzjax` (in-browser WebAssembly, no server LaTeX toolchain). See `.agents/plans/tikzjax-rendering.md` for integration spec.
- **Renderer/filter settings** — Settings UI: render command as canonical copy-pastable one-liner (raw textarea), template/filter pickers backed by `~/.pandoc/` directory scans, synced to `pandoc-preview.toml`. See audit note.
- **Renderer diagnostics UI** — Richer stderr/nonzero-exit display beyond the current error document. See `.agents/plans/renderer-diagnostics-ui.md`.
- **Diagram toolbar modal** — One-button access to diagram tools (FreeTikZ, quiver, Qtikz, Tikzit, Inkscape, Xournal) with save gate and `./figures/` auto-creation.

## Deprioritized

- **LaTeX syntax concealing** — Conceal LaTeX syntax in editor for readability.
- **QuickTex snippet expansion** — Expand LaTeX snippets in editor.
- **CriticMarkup GUI, agent chat, TikZJax (old card)** — Large, speculative, editor-behavior-heavy, or too close to renderer ownership.
