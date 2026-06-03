# Live LLM-Review Findings

This file tracks the **current** high-signal implementation-quality findings for the live branch.
It intentionally separates stale historical claims from issues that were still real in the Tauri codebase.

## Findings retired as stale

These older findings should not be carried forward as active problems:

1. **Monolithic 1662-line `App.tsx` god object**
   - The client has already been componentized; `App.tsx` is now the app coordination layer plus callbacks/state.

2. **Express event-loop blocking quick-open traversal**
   - The reviewed implementation is no longer an Express server.
     That framing belonged to an earlier architecture.

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

## Proof-loop status correction

- The browser-smoke test is a harness check only.
  It uses explicit Tauri IPC mocks and proves only that mocked shell boundary.
- The canonical proof burden is specified in `docs/testing-proof-obligations.md`.
- The migration from old Express tests to current Tauri tests is tracked in `.agents/plans/port-e2e-tests-from-main.md`.
- Do not treat `just test` pass/fail as an app-readiness signal until the migrated suite has been repaired as a valid proof instrument.
  The plan documents current non-admissible patterns and requires direct test-suite repairs before app pass/fail claims.
- Current non-admissible patterns are not theoretical; the active suite contains test files excluded from TypeScript checking, project config type escapes, `@ts-nocheck`, loose known-payload casts, duplicate weak helpers, dependency skips, and a CJS `require()` helper in an ESM spec.
- Future agents working failed tests must use the debugging framework in `.agents/plans/port-e2e-tests-from-main.md`. The expected weak-agent failures are predictable: timeout/retry inflation, direct-IPC shortcuts, browser-mode or mocked-IPC substitution, assertion rewriting, duplicate helper growth, swallowed diagnostics, fixture shape laundering, and targeted green-status reward hacking.
  A failed test must be classified as app defect, incorrect test, harness misuse, fixture/config defect, or invalid proof design before any fix.
