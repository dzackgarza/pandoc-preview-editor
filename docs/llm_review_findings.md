# Live LLM-Review Findings

This file tracks the **current** high-signal implementation-quality findings for the live branch. It intentionally separates stale historical claims from issues that were still real in the Tauri codebase.

## Findings retired as stale

These older findings should not be carried forward as active problems:

1. **Monolithic 1662-line `App.tsx` god object**
   - The client has already been componentized; `App.tsx` is now the app coordination layer plus callbacks/state.

2. **Express event-loop blocking quick-open traversal**
   - The reviewed implementation is no longer an Express server. That framing belonged to an earlier architecture.

3. **Regex-on-HTML asset rewriting**
   - The HTML post-processing layer that used to justify this finding no longer exists in the live code.

4. **HTTP autosave spam**
   - Backup now uses Tauri IPC rather than browser-to-server POST traffic.

5. **Timing-theater responsiveness tests**
   - The old timing-assertion test file is gone.

## Findings that were still real and are now addressed here

1. **Registered-but-unreachable command surface**
   - Dead `quick_open`, `list_filters`, and `toggle_filters` commands were still registered in Tauri despite having no live client caller.
   - The dead surface has been removed so the backend command list reflects the actual UI.

2. **Inert central-figures scaffolding**
   - The backend still carried a `Central` figures-storage mode plus registry code even though the UI never enabled it.
   - The live workflow is document-relative `./figures/`, so the dead scaffold was removed and the figures browser now scans the workspace for real figure files.

3. **Patch-accreted config initialization**
   - Repeated strict/default config guards were copy-pasted field by field.
   - That repeated shape now goes through a shared helper.

4. **Bespoke PATH probing and fake launcher fallback**
   - Tool detection manually walked `$PATH`, and quick-open pretended `dmenu` existed even when no launcher was available.
   - Tool probing now uses `which`, and quick-open fails explicitly when the required launcher dependency is absent.

## Proof-loop correction completed here

- The previously failing Playwright browser-smoke test is now fixed.
- The real harness issue was not the app shell itself; it was the test boundary:
  - the smoke test now injects explicit Tauri IPC mocks directly into a plain browser page, matching the boundary it is supposed to prove;
  - Playwright now launches Vite from the repository root instead of `src/tests/`, so the smoke run no longer serves a 404 shell from the wrong working directory;
  - the web server is owned by the test run instead of silently reusing an ambient process.

With that correction, the proof loop is back to `just typecheck` plus `just test`, and the earlier smoke failure should no longer be treated as an open branch-level issue.
