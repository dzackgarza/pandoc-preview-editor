# Current Architecture Report: pandoc-preview

This branch is no longer the older React + Express prototype described by earlier audit notes. The live app is a **Tauri-first** editor: the React client talks directly to the Rust backend through Tauri `invoke` commands, and preview rendering/file operations are owned by Rust rather than an HTTP server layer.

## Current shape

- **Frontend:** React client in `src/client/`, with `App.tsx` acting as the state/integration layer and major UI pieces extracted into components such as `EditorPane`, `PreviewPane`, `SettingsDialog`, `ExplorerDrawer`, and `TopMenuBar`.
- **Backend:** Rust commands under `src-tauri/src/commands/`, registered from `commands/mod.rs`.
- **Renderer/config flow:** the backend owns config loading, renderer command parsing, save/backup, plugin execution, and workspace/file identity.
- **Asset workflow:** templates and filters remain centralized under the configured Pandoc directories; figures and pasted images now follow the document-relative `./figures/` workflow used by the app and docs.

## Resolved findings that should no longer be treated as live

The following older review claims are stale:

1. **“App.tsx is a 1600+ line god object.”** The file is still the app coordination layer, but the major presentation/dialog surfaces have already been extracted into dedicated components.
2. **“The app uses an Express/HTTP preview pipeline with regex HTML rewriting.”** That server layer is gone in the live Tauri implementation.
3. **“Quick open blocks the Node event loop with synchronous traversal.”** The Node/Express event-loop framing no longer matches the architecture.
4. **“Autosave spams HTTP requests.”** Backup now goes through Tauri IPC rather than client-to-server POST traffic.
5. **“Timing-assertion responsiveness tests prove the architecture.”** The old timing-theater test file is gone.

## Live implementation-quality cleanup completed on this branch

This branch now removes the remaining backend slop that was still real in the live code:

1. **Dead Tauri command surfaces removed.**
   - Removed registered-but-unreachable commands for the older quick-open/filter-management path.

2. **Figures workflow brought back in line with the stated architecture.**
   - Removed the inert “central figures directory” scaffold that had no activation path.
   - Diagram creation and pasted-image saving now consistently target document-relative `./figures/`.
   - The Figures Library now scans the current workspace for those figure files instead of depending on a dead central registry path.

3. **Config bootstrap repetition reduced.**
   - The repeated “strict when config exists, default otherwise” parsing pattern is now centralized through a helper instead of being copy-pasted field by field.

4. **Tool probing and launcher selection tightened.**
   - Tool availability now uses `which` instead of a bespoke `$PATH` existence probe.
   - Quick open now fails explicitly when neither `rofi` nor `dmenu` exists instead of pretending `dmenu` is available.

## Forward-facing guidance

- Treat the app as a **Rust-backed desktop editor**, not as a web server with a browser client.
- Treat `App.tsx` as the orchestration boundary, not as a dumping ground for new UI leaves.
- Keep figure/asset behavior aligned with **document-relative paths** and the save gate.
- Do not add new backend commands unless the client has a real caller and proof loop.
- Prefer existing dependencies and shared helpers over bespoke path-walking, registry, or command-detection code.

## Current proof loop

- `just typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `just test`

The browser-smoke proof now runs against an explicitly repo-rooted Vite server plus explicit Tauri IPC mocks, so the forward-facing test loop is green again instead of depending on an ambient dev server or tauri-playwright browser-mode quirks.
