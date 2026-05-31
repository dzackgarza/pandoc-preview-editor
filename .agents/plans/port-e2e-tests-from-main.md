# Port Old Express E2E Tests to Tauri Architecture

## Goal

- **Current defect:** The test suite has 48 Rust unit tests that test utility
  functions (path normalization, config serialization, command parsing, HTML string
  content) and 1 trivial Playwright test that checks UI shell rendering. None of
  these prove the app boundary: type markdown → see pandoc output in preview.
- **Target state:** All old Express-era Playwright tests from `main` branch are
  ported to work with the Tauri/Rust IPC backend. `just test` proves the app works.
- **Why this matters:** The old tests were deleted during the migration instead of
  ported. The replacement tests (48 Rust unit tests) test the wrong layer — they
  cover internal Rust functions, not the app boundary. Without working E2E tests,
  regressions are invisible.

## Constraints

- Use Playwright browser mode for UI-only tests (headless Chromium, no GUI).
- Use Playwright tauri mode for tests needing IPC (render pipeline, file ops).
  GUI window suppressed via `xvfb-run` in `run-tauri-dev.sh` (confirmed working).
- Every feature that existed in the Express app still exists in the Tauri app.
  No tests are excluded because a feature was "lost" — if a feature is missing,
  that's a migration gap, not a test exclusion.
- No IPC mocks. Real Tauri IPC is the only testing boundary.
- All test files go in `src/tests/e2e/`. No top-level `src/tests/*.spec.ts`.
- The `justfile` has only: `test` (full suite), `test-rust` (Rust only),
  `test-verbose` (Rust with output). No partial-bypass E2E recipes.

## Prerequisites

- `xvfb-run` available on system (confirmed: yes, at `/usr/bin/xvfb-run`)
- Pandoc installed (for render tests)
- Vite dev server starts cleanly (via Playwright `webServer`)
- `run-tauri-dev.sh` wraps `npx tauri dev` in `xvfb-run` to suppress GUI

## Scope

Port ALL old test files from `main`. Each file tests a feature that the Tauri app
still owns, regardless of whether the backend implementation changed from Express
HTTP to Tauri IPC.

### Full inventory (17 test files from main):

1. `e2e.spec.ts` — proof loop: torture document → preview iframe assertions
2. `renderer-diagnostics.spec.ts` — render errors shown in UI
3. `editor-height.spec.ts` — editor sizing
4. `file-integrity.spec.ts` — file save/reload preserves content
5. `settings.spec.ts` — settings dialog read/write
6. `plugins.spec.ts` — plugin execution
7. `diagram-workflow.spec.ts` — diagram toolbar and launch
8. `tikz-filter.spec.ts` — TikZ diagram compilation via pandoc
9. `tikzjax.spec.ts` — in-browser TikZ rendering (NOTE: AGENTS.md forbids
   tikzjax. This test may need to be dropped or rewritten for the allowed
   server-side TikZ path. Evaluate during porting.)
10. `config-loading.spec.ts` — config file loading from disk
11. `session-persistence.spec.ts` — session autosave and recovery
12. `mime-types.spec.ts` — MIME type detection for file operations
13. `architectural-regression.spec.ts` — regression suite for known failure
    patterns (regex, dead code)
14. `command-parsing.spec.ts` — render command string parsing (now owned by
    Rust `command_flags` module)
15. `bug-fixes.spec.ts` — regression tests for past bugs (may need new bug
    scenarios specific to Tauri architecture)
16. `file-selector.spec.ts` — file open/save dialog
17. `user-behaviors.spec.ts` — keyboard shortcuts, save flow, new/create file
18. `failing-renderer.mjs` — helper for renderer error tests (may or may not
    port depending on whether the test needs a fake renderer)

### Removed (current branch):

- 48 Rust tests in `src-tauri/src/` identified as slop: `command_flags::tests`,
  `commands::plugins::tests`, `render::tests`, `config::tests`, `fs_utils::tests`.
  These test internal Rust functions, not the app boundary. The render tests
  duplicate the E2E proof loop. The utility tests have no E2E equivalent but
  are not the right test layer for a proof loop.

## Phases

### Phase 0: Infrastructure

Set up the test runner configuration and helpers that the ported tests share.

Tasks:
- `run-tauri-dev.sh`: wrap `exec npx tauri dev "$@"` with `xvfb-run` — suppresses
  the GUI window while allowing Tauri IPC to work
- `editor-helpers.ts`: port from main branch, remove `__PANDOC_PREVIEW_STATE__`
  dependency (no longer exists in Tauri app)
- `fixtures.ts`: already clean (no IPC mocks). No changes needed.
- `playwright.config.ts`: already configured with `webServer` for Vite and two
  projects (`browser-smoke`, `tauri`). No changes needed.
- `justfile`: already has clean set of recipes (`test`, `test-rust`, `test-verbose`)

### Phase 1: Core Proof Loop

Port the main E2E test: type markdown → verify preview iframe content.

- Source: `main:src/tests/e2e.spec.ts`
- Target: `src/tests/e2e/app.spec.ts` (replace current trivial test)
- Mode: `tauri` (needs IPC for render pipeline), `xvfb-run` suppresses window
- Key change: replace `frameLocator('#preview')` with `evaluate()` to read iframe
  content (TauriPage doesn't have frameLocator)

### Phase 2: All Other E2E Tests

Port every remaining old test file. Each test may need:
- `launchServer`/`killServer` replaced by `tauriPage` fixture (for IPC tests)
- `page` replaced by `tauriPage` (tauri mode) or kept as `page` (browser mode)
- `frameLocator` replaced by `evaluate()` for iframe content access
- `window.__PANDOC_PREVIEW_STATE__` replaced by equivalent Tauri IPC calls
- Express endpoint calls replaced by Tauri IPC invoke equivalents
- CLI spawn tests adapted to test the Tauri app's behavior instead

List (sources from `main:src/tests/`, targets to `src/tests/e2e/`):

- `renderer-diagnostics.spec.ts`
- `editor-height.spec.ts`
- `file-integrity.spec.ts`
- `settings.spec.ts`
- `plugins.spec.ts`
- `diagram-workflow.spec.ts`
- `tikz-filter.spec.ts`
- `tikzjax.spec.ts` (evaluate: drop if AGENTS.md forbids tikzjax entirely)
- `config-loading.spec.ts`
- `session-persistence.spec.ts`
- `mime-types.spec.ts`
- `architectural-regression.spec.ts`
- `command-parsing.spec.ts`
- `bug-fixes.spec.ts`
- `file-selector.spec.ts`
- `user-behaviors.spec.ts`

### Phase 3: Remove Slop Tests

Delete the 48 Rust tests that were created as replacement for the deleted E2E tests
but test the wrong layer.

- Remove `render::tests` (5 tests, replaced by Phase 1)
- Remove `command_flags::tests` (17 tests, utility parsing)
- Remove `commands::plugins::tests` (3 tests, utility interpolation)
- Remove `config::tests` (3 tests, config serialization)
- Remove `fs_utils::tests` (~19 tests, path utilities)

### Phase 4: Verification

- `just test` passes with full suite (Rust + Playwright)
- No leftover zombie processes
- No visible GUI windows during test run
- The proof loop test actually proves: type markdown → see pandoc HTML in preview

## System-Level Validation

- `just test` runs all Rust + all Playwright, exits 0
- No orphan processes after test run
- Proof loop test: set markdown containing `**bold**` → preview iframe contains
  `<strong>bold</strong>`
- Proof loop test: set torture document → preview iframe contains `div.theorem`,
  `div.proof`, table rows, math elements

## Risks / Rollback

- **Risk:** Some old tests depend on Express-specific helpers (e.g., `failing-renderer.mjs`,
  `window.__PANDOC_PREVIEW_STATE__`) that have no Tauri equivalent.
  **Mitigation:** Rewrite the test to use the Tauri mechanism for the same outcome.
  If the feature genuinely no longer exists, that's a migration gap — file an issue,
  don't silently exclude the test.
- **Risk:** `TauriPage.evaluate()` may not return iframe content correctly (CSP,
  cross-origin restrictions in the preview iframe).
  **Mitigation:** Test with simple evaluate call first.
  Fallback: extract preview content via `__PANDOC_PREVIEW_STATE__`-like mechanism
  if one exists, or add one.
- **Rollback:** All changes are forward-only (new files, no destructive edits to
  existing Rust code at first). If a test fails because the Tauri app actually
  lacks the feature, note the gap and move on — do not delete the test.

## Stop Rules

- Do not proceed to Phase 2 until Phase 1 test passes reliably.
- Do not remove Rust slop tests until Phase 1 test passes (so we have at least one
  working test).

## Execution Progress

### Prerequisites

- [x] <!-- status: completed --> All old test files read from main branch
- [x] <!-- status: completed --> `xvfb-run npx tauri dev` verified to work (ping+eval both respond)
- [x] <!-- status: completed --> Current trivial test passes in browser mode (done in previous commit)

### Phase 0: Infrastructure

- [ ] <!-- status: pending --> Task 0.1: Update `run-tauri-dev.sh` with `xvfb-run`
- [ ] <!-- status: pending --> Task 0.2: Write ported `editor-helpers.ts`

### Phase 1: Core Proof Loop

- [ ] <!-- status: pending --> Task 1.1: Port `e2e.spec.ts` to `app.spec.ts`
- [ ] <!-- status: pending --> Task 1.2: Verify proof loop test passes

### Phase 2: Supporting E2E Tests

- [ ] <!-- status: pending --> Task 2.1: Port renderer-diagnostics.spec.ts
- [ ] <!-- status: pending --> Task 2.2: Port editor-height.spec.ts
- [ ] <!-- status: pending --> Task 2.3: Port file-integrity.spec.ts
- [ ] <!-- status: pending --> Task 2.4: Port settings.spec.ts
- [ ] <!-- status: pending --> Task 2.5: Port plugins.spec.ts

### Phase 3: Remove Slop Tests

- [ ] <!-- status: pending --> Task 3.1: Remove Rust test modules

### Phase 4: Verification

- [ ] <!-- status: pending --> `just test` passes
- [ ] <!-- status: pending --> No orphan processes, no visible GUI
- [ ] <!-- status: pending --> Proof loop test proves: type markdown → preview HTML
