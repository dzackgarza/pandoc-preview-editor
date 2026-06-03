# pandoc-preview TODO

## File Integrity Implementation (Active Branch: feature/file-integrity)

- [x] **Task 1: Refactor Save Endpoints for Atomicity**
  - Implement safe atomic writes via a temporary sibling file (e.g., `.${filename}.tmp.[uuid]`) in the same directory.
  - Sync the file descriptor to physical disk before renaming.
  - Atomically rename the temporary file over the target destination using `fs.renameSync`.
- [x] **Task 2: Implement File Fingerprinting & Conflict Prevention**
  - Cache modification time (`mtimeMs`) and content hash upon opening or successfully saving a file.
  - Verify if the disk version has been modified by an external process before writing.
  - Halt saving and return a conflict error if an external change is detected, enabling user resolution.

## Active (Main Backlog)

- **Complete Tauri E2E suite migration** — Finish reconciling the old Express suite with the current Tauri architecture.
- **Document banned E2E patterns and current failures** — Keep a durable list of non-admissible suite patterns and file-level failures so future work fixes tests instead of counting defective proofs.
- **Document failed-test debugging protocol** — Require causal notes, complete logs/artifacts, boundary classification, and review after repeated failed fixes before changing app code, assertions, fixtures, helpers, or adapter calls.
- **Repair non-admissible migrated tests** — Remove `@ts-nocheck`, `as any`, loose known-payload casts, CJS `require()` in ESM tests, dependency skips, duplicate weak helpers, unsupported adapter calls, and mock-only feature proofs from the active E2E suite.
- **Audit migrated suite against proof obligations** — Confirm the repaired suite models `docs/testing-proof-obligations.md` with real Tauri desktop proofs before using `just test` as an app-satisfaction gate.
- **Satisfy Tauri desktop proof burden** — After the suite is complete and correct, make `just test` pass through the real Tauri Playwright suite.
- **Server-side TikZ rendering proof** — Prove TikZ renders through server-side Pandoc -> SVG, not browser-side TikZJax.
- **Obsidian callout → amsthm** — Convert Obsidian callouts to amsthm environments.
- **Centralized Pandoc template/filter QA** — Optional manual QA around `~/.pandoc/templates/` and `~/.pandoc/filters/`; app tests stay renderer-agnostic.

## Completed

- **Renderer/filter settings** — Settings UI: render command as canonical copy-pastable one-liner (raw textarea), template/filter pickers backed by `~/.pandoc/` directory scans, synced to `pandoc-preview.toml`. See audit note.
- **Renderer diagnostics UI** — Richer stderr/nonzero-exit display beyond the current error document.
  See `.agents/plans/renderer-diagnostics-ui.md`.
- **Diagram toolbar modal** — One-button access to diagram tools (FreeTikZ, quiver, Qtikz, Tikzit, Inkscape, Xournal) with save gate and `./figures/` auto-creation.

## Deprioritized

- **TikZJax rendering** — Retired.
  AGENTS.md forbids in-browser TikZ rendering; TikZ must render server-side through Pandoc to SVG.
- **LaTeX syntax concealing** — Conceal LaTeX syntax in editor for readability.
- **QuickTex snippet expansion** — Expand LaTeX snippets in editor.
- **CriticMarkup GUI, agent chat, TikZJax (old card)** — Large, speculative, editor-behavior-heavy, or too close to renderer ownership.
