# pandoc-preview TODO

## Active

- **TikZJax rendering** — `` ```tikz `` code blocks render as SVG in the preview
  via `@jhuix/tikzjax` (in-browser WebAssembly, no server LaTeX toolchain).
  See `.agents/plans/tikzjax-rendering.md` for integration spec.
- **Renderer/filter settings** — Settings UI: render command as canonical
  copy-pastable one-liner (raw textarea), template/filter pickers backed by
  `~/.pandoc/` directory scans, synced to `pandoc-preview.toml`. See audit note.
- **Renderer diagnostics UI** — Richer stderr/nonzero-exit display beyond the
  current error document. See `.agents/plans/renderer-diagnostics-ui.md`.
- **Diagram toolbar modal** — One-button access to diagram tools (FreeTikZ,
  quiver, Qtikz, Tikzit, Inkscape, Xournal) with save gate and `./figures/`
  auto-creation.
- **Obsidian callout → amsthm** — Convert Obsidian callouts to amsthm
  environments.
- **Centralized Pandoc template/filter QA** — Optional manual QA around
  `~/.pandoc/templates/` and `~/.pandoc/filters/`; app tests stay
  renderer-agnostic.

## Deprioritized

- **LaTeX syntax concealing** — Conceal LaTeX syntax in editor for readability.
- **QuickTex snippet expansion** — Expand LaTeX snippets in editor.
- **CriticMarkup GUI, agent chat, TikZJax (old card)** — Large, speculative,
  editor-behavior-heavy, or too close to renderer ownership.
