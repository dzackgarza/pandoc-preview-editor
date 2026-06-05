# pandoc-preview TODO

> [!NOTE]
> This document is **NON-NORMATIVE**. It is a task tracker only.
> All product and architecture requirements are owned by `.agents/memories/REQUIREMENTS.md` and `.agents/memories/DESIGN-COMMITMENTS.md`.
> Any task that contradicts the requirements authority is invalid and must be removed or re-scoped.

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
- **Remediate Diagram Integration Slop** — Burn the agent-flavored implementation residue in the diagram generation workflow:
  - **Study and Cement Extraction Contracts**: Perform a one-time study of `q.uiver.app` and `freetikz` to determine the EXACT CSS selectors and internal data shapes.
  - **Replace Heuristic Scraper**: Replace the "obsequious" `for`-loop scraper in `src-tauri/assets/tikz-overlay.html` with the deterministic findings from the study. Assert on specific structure and shape.
  - **Refactor Command Injection**: Refactor `diagram_proxy` in `src-tauri/src/commands/diagram.rs` to stop using retired regex-on-HTML (`replacen`) for script injection. Use structural injection.
  - [x] **Purge High-Entropy Slop**: Remove "Premium" and "Gorgeous" LLM markers from comments and UI code.
- **Remediate Preview Overlay Layer Laundering** — Fix the layer violation in `src/client/components/PreviewPane.tsx`:
  - **Burn App-Side Scraper**: Remove the `useEffect` that imperatively queries the iframe DOM and appends "Edit" overlays. This is "layer laundering"—using the app to fix HTML that the app already controls at the source.
  - **Template-Side Implementation**: Move the "Hover-to-Edit" logic into a modular JavaScript library included in the Pandoc template.
  - **Filter-Provided Hooks**: Update the project's Pandoc filters to provide canonical hooks (e.g., semantic classes or data-attributes) that the template-side JS uses to identify and interact with editable figures.
  - **Thin App Integration**: Reduce the React layer's role to a minor integration that listens for `postMessage` edit commands from the iframe and dispatches them to the Rust backend.
- **Remediate Testing Hacks in Production** — Remove brittle window globals and type suppressions used for E2E verification:
  - [x] **Burn Window Globals**: Remove `__PANDOC_PREVIEW_BACKUP_COMPLETED__` and `__PANDOC_PREVIEW_EDITOR_VIEW__` from `App.tsx` and `EditorPane.tsx`.
  - [x] **Standard DOM Verification**: Update E2E tests to verify editor content via standard locators (e.g., `.cm-content`) rather than reaching into the CodeMirror instance.
  - [x] **Deterministic UI Signals**: Replace the backup counter with a real UI signal (e.g., a "Backup Saved" status transition) or an observable state that reflects background process completion.
  - [x] **Remediate E2E Clipboard Theater**: Replace the browser-side event simulation in `src/tests/e2e/workflow-extensions.spec.ts` with a platform-native utility (e.g., `wl-copy` or `xclip`) to populate the real system clipboard, ensuring the Tauri IPC and OS boundary are tested.
  - [x] **Type Safety**: Eliminate all `@ts-ignore` usages. If a global is strictly required for the test adapter (like `__PW_ACTIVE__`), define it properly in the `Window` interface.
- **Remediate Rust Fail-Fast Violations** — Fix the use of banned `let _ =` patterns that silence critical filesystem errors in `src-tauri/src/config.rs`:
  - [x] **Fix Silenced Errors**: Replace `let _ = fs::create_dir_all(...)` and `let _ = fs::write(...)` with proper error handling (returning `Result` or using `expect`).
  - **Float to Global QC**: Propagate this violation pattern to the global Quality Control system (`~/ai/quality-control`).
  - **Rust-Specific Rules**: Implement Rust semgrep rules in global QC to detect and block `let _ =` on `Result` types.
  - **Sync QC Back**: Push the updated global QC rules back into this repository to surface such violations automatically in the future.
- **Systemic Audit of Silent Defaults & Dead Code** — Investigate and burn "fail-open" patterns and abandoned code in the Rust backend:
  - **Burn unwrap_or* Pervasiveness**: Audit all 26+ instances of `unwrap_or`, `unwrap_or_default`, and `unwrap_or_else` in `src-tauri/src/`. Replace "soft" defaults (like `unwrap_or("")` or `unwrap_or_default()`) with explicit error propagation (`?`) or loud assertions (`expect`).
    - [x] **Harden Backup Path Resolution**: Refactor `get_backup_path` in `config.rs` to return a `Result` and remove the silent canonicalization fallback.
  - [x] **Fix State Logic Errors**: Specifically fix `src-tauri/src/state.rs`:
    - [x] `current_file_content`: Return a proper error instead of an empty string default when no file/content is present.
    - [x] `workspace_root`: Fail loudly if `current_dir()` cannot be determined instead of defaulting to `.`.
    - [x] `probe_tool_state`: Fail if a required diagram tool is missing instead of defaulting to a potentially incorrect binary name.
  - [x] **Harden Sorting Logic**: Replace `unwrap_or("")` sorting fallbacks and `Value::Null` defaults in `src-tauri/src/commands/document.rs` with structured DTOs and explicit Option handling.
  - [x] **Delete Dead Code**: Remove `FigureEntry` in `state.rs` and audit for other unused structs or registration-only dead paths.
  - **Policy Enforcement**: Move these checks into the project's verification gate to ensure future code adheres to the "Silence is a bug" mandate.
- **Remediate Templates-as-Code Slop** — Remove embedded template content from application JSON/code:
  - [x] **Extract Embedded Templates**: Move the starter TikZ/SVG/Xournal/Ipe templates out of `src/shared/diagram-tools.json` and into dedicated asset files (e.g., in `src-tauri/assets/templates/` or `~/.pandoc/templates/`).
  - [x] **Adhere to AGENTS.md**: Ensure that app code only references these templates by path or resource ID, never embedding the content itself.
- **Remediate Bespoke Filesystem Logic Slop** — Burn bespoke reimplementations of solved filesystem problems in `src-tauri/src/fs_utils.rs`:
  - [x] **Burn Manual Sniffing**: Replace `is_text_like_file` and hardcoded `TEXT_EXTENSIONS`/`BINARY_EXTENSIONS` with mature crates like `content_inspector` or `infer`.
  - [x] **Burn Manual Sanitization**: Replace the manual char-iterating `sanitize_figure_filename` with a standard crate like `path-sanitize` to handle OS reserved names and non-ASCII characters reliably.
- **Remediate Figure Registry Sniffing** — Implement the Global Figures Directory contract to fix heuristic boundary-scanning:
  - [x] **Global Configuration**: Add a `figures_dir` field to the user configuration to establish a single centralized location for all academic assets (TikZ, SVG, clipboard images).
  - [x] **Burn Magic Folder Sniffing**: Remove the `is_workspace_figure` logic in `src-tauri/src/commands/figures.rs` that heuristically looks for folders named "figures". The Figure Library must exclusively scan the configured global directory.
  - [x] **Cross-Document Reuse**: Ensure that pasting or generating a new figure saves directly to the global directory, enforcing the opinionated default and allowing canonical updates across multiple papers.
- **Remediate IPC Success Laundering & Signature Bloat** — Fix the user-deceptive "Partial Success" pattern and parameter accretion in the renderer IPC:
  - [x] **Honest IPC Errors**: Refactor `execute_render` in `src-tauri/src/render.rs` to return a real `Err` on subprocess failure instead of an `Ok(RenderResult { ok: false })`.
  - [x] **Remove HTML Comments for Errors**: Eliminate the practice of injecting error messages into the HTML stream via `<!-- renderer error -->`.
  - [x] **Structured Config DTO**: Refactor `set_config` in `src-tauri/src/commands/config.rs` to accept a single structured object (e.g., `ConfigUpdate` DTO) utilizing Serde, eliminating positional primitive arguments (signature bloat).
- **Refactor App.tsx God Object** — Decompose the 500+ line root component into domain-specific hooks and components:
  - [x] **Domain Hooks**: Extract state and logic into `useFileManager`, `useRenderer`, `usePlugins`, etc., to reduce re-render blast-radius and context-window pressure.
  - [x] **Modular Error View Component**: Replace the string-concatenated `errorDocument` blob with a first-class React component rendered into the preview pane, eliminating manual HTML-in-JS laundering.
  - [x] **Standard Utilities**: Replace bespoke `escapeHtml` with mature libraries or browser-native `textContent` assignment.
- [x] **Burn Timing Theater in IPC Contract** — Move `duration_ms` out of the core `RenderResult` success contract in `render.rs`. It is diagnostic metadata, not a success criterion, and its presence in the contract invites brittle "latency-based" tests.
- **Server-side TikZ rendering proof** — Prove TikZ renders through server-side Pandoc -> SVG, not browser-side TikZJax.
- **Obsidian callout → amsthm** — Convert Obsidian callouts to amsthm environments.
- **Centralized Pandoc template/filter QA** — Optional manual QA around `~/.pandoc/templates/` and `~/.pandoc/filters/`; app tests stay renderer-agnostic.

## Completed

- **Renderer/filter settings** — Settings UI: render command as canonical copy-pastable one-liner (raw textarea), template/filter pickers backed by `~/.pandoc/` directory scans, synced to `pandoc-preview.toml`. See audit note.
- **Renderer diagnostics UI** — Richer stderr/nonzero-exit display beyond the current error document. See `.agents/plans/renderer-diagnostics-ui.md`.
- **Diagram toolbar modal** — One-button access to diagram tools (FreeTikZ, quiver, Qtikz, Tikzit, Inkscape, Xournal) with save gate and `./figures/` auto-creation.

## Deprioritized

- **TikZJax rendering** — Retired. AGENTS.md forbids in-browser TikZ rendering; TikZ must render server-side through Pandoc to SVG.
- **LaTeX syntax concealing** — Conceal LaTeX syntax in editor for readability.
- **QuickTex snippet expansion** — Expand LaTeX snippets in editor.
- **CriticMarkup GUI, agent chat, TikZJax (old card)** — Large, speculative, editor-behavior-heavy, or too close to renderer ownership.
