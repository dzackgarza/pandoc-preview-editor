# Port Old Express E2E Tests to Tauri Architecture

## Goal

- **Current defect:** The Express-era E2E suite was deleted during the Tauri migration instead of being ported and reconciled with the current architecture.
- **Target state:** The Tauri E2E suite is a correct proof instrument: it type-checks, uses the Tauri Playwright adapter according to its real API, uses real runtime objects, and models the proof obligations in `docs/testing-proof-obligations.md`.
- **Why this matters:** Suite migration, suite correctness, proof-obligation coverage, and app pass/fail status are separate phases.
  This plan tracks the migration and suite-repair work.
  The proof-obligation document defines what the suite must model.
  Only after the migrated suite is correct and complete does `just test` become evidence about whether the app satisfies the burden.

## Current Migration State

Checked on June 2, 2026:

- Shared Tauri Playwright infrastructure exists: `run-tauri-dev.sh`, `fixtures.ts`, `editor-helpers.ts`, and `tauri.e2e.conf.json`.
- Ported or replacement E2E files exist under `src/tests/e2e/`, including proof-loop, settings, plugins, file workflows, diagnostics, command parsing, config loading, and academic rendering coverage.
- Browser-side TikZJax is not an active architecture target; replace those historical tests with server-side Pandoc -> SVG TikZ proofs.
- The suite still needs an explicit correctness and coverage audit against `docs/testing-proof-obligations.md`.
- Tauri v2 command arguments use camelCase invoke keys by default.
  Use snake_case only for commands declared with `#[tauri::command(rename_all = "snake_case")]`. `set_config` currently has no `rename_all` override, so camelCase calls match the command declaration.

## Current Non-Admissible Patterns and Failures

These are blockers on treating the suite as a proof instrument.
They are not app pass/fail results.

- `tsconfig.json` excludes `src/tests`, so the current `just typecheck` recipe does not type-check the E2E suite.
- `just test` runs Rust tests and Playwright directly.
  It should not be used as app evidence until the test suite itself has first been judged type-correct and free of the documented banned patterns.
- `src/tests/playwright.config.ts` type-escapes the project `use` config with `as any`, so adapter configuration drift is not caught by TypeScript.
- `src/tests/e2e/user-behaviors.spec.ts` opts the whole file out of type-checking with `// @ts-nocheck`.
- Several specs inspect known Tauri IPC/config payloads through `as any` or loose `Record<string, unknown>` casts instead of exact response types or boundary parsers.
- `src/tests/e2e/desktop-file-workflows.spec.ts` defines local `any`-typed editor/preview helpers instead of using the shared typed helper layer.
- `src/tests/e2e/file-selector.spec.ts` contains an unused CJS `require()` cleanup helper with a swallowed catch inside an ESM module.
- `src/tests/e2e/tikz-filter.spec.ts` uses `test.skip` for missing or failing hard dependencies.
  Hard dependencies must fail in prerequisite setup, not disappear from the proof suite.
- `src/tests/e2e/app.spec.ts` is allowed to remain a browser-smoke harness check only if it is clearly excluded from proof-obligation coverage.
  Mocked IPC in that file must not be counted as feature proof.

## Constraints

- Use Playwright browser mode for UI-only tests (headless Chromium, no GUI).
- Use Playwright tauri mode for tests needing IPC (render pipeline, file ops).
  GUI window suppressed via `xvfb-run` in `run-tauri-dev.sh` (confirmed working).
- Recover the old user-facing proof obligations, not obsolete Express mechanics.
  Express endpoint tests, static MIME serving tests, central-figures-registry tests, and browser-side TikZJax tests must be replaced by current Tauri-owned workflows or retired when the architecture explicitly forbids the old behavior.
- No IPC mocks.
  Real Tauri IPC is the only testing boundary.
- All test files go in `src/tests/e2e/`. No top-level `src/tests/*.spec.ts`.
- The public proof surface is `just test` only after the suite has been judged correct and complete.
  Standalone type-check output can diagnose test-code correctness, but it is not app pass/fail evidence.

## Prerequisites

- `xvfb-run` available on system (confirmed: yes, at `/usr/bin/xvfb-run`)
- Pandoc installed (for render tests)
- Vite dev server starts cleanly (via Playwright `webServer`)
- `run-tauri-dev.sh` wraps `npx tauri dev` in `xvfb-run` to suppress GUI

## Scope

Recover all repository-owned behavior that the old tests were trying to prove.
Do not port obsolete proof shapes verbatim.
Each surviving proof must target the current Tauri app boundary, even when the old source file was Express-specific.

### Historical inventory from `main`

1. `e2e.spec.ts` — proof loop: torture document → preview iframe assertions
2. `renderer-diagnostics.spec.ts` — render errors shown in UI
3. `editor-height.spec.ts` — editor sizing
4. `file-integrity.spec.ts` — file save/reload preserves content
5. `settings.spec.ts` — settings dialog read/write
6. `plugins.spec.ts` — plugin execution
7. `diagram-workflow.spec.ts` — diagram toolbar and launch
8. `tikz-filter.spec.ts` — TikZ diagram compilation via pandoc
9. `tikzjax.spec.ts` — in-browser TikZ rendering.
   AGENTS.md forbids this architecture.
   Do not recreate it; replace it with server-side Pandoc -> SVG TikZ proofs.
10. `config-loading.spec.ts` — config file loading from disk
11. `session-persistence.spec.ts` — session autosave and recovery
12. `mime-types.spec.ts` — MIME type detection for file operations
13. `architectural-regression.spec.ts` — regression suite for known failure patterns (regex, dead code)
14. `command-parsing.spec.ts` — render command string parsing (now owned by Rust `command_flags` module)
15. `bug-fixes.spec.ts` — regression tests for past bugs (may need new bug scenarios specific to Tauri architecture)
16. `file-selector.spec.ts` — file open/save dialog
17. `user-behaviors.spec.ts` — keyboard shortcuts, save flow, new/create file
18. `failing-renderer.mjs` — helper for renderer error tests (may or may not port depending on whether the test needs a fake renderer)

### Removed or no longer primary proof surface

- The large Rust helper-test replacement suite is gone.
  The current Rust test surface is small and does not substitute for desktop proof.
  It can catch narrow helper invariants, but `just test` must still prove the app boundary.

## Work Plan

### Existing Infrastructure Baseline

Set up the test runner configuration and helpers that the ported tests share.

Tasks:
- `run-tauri-dev.sh`: wrap `exec npx tauri dev "$@"` with `xvfb-run` — suppresses the GUI window while allowing Tauri IPC to work
- `editor-helpers.ts`: port from main branch, remove `__PANDOC_PREVIEW_STATE__` dependency (no longer exists in Tauri app)
- `fixtures.ts`: already avoids IPC mocks, but its cleanup error handling must be reviewed under the banned-pattern rules.
- `playwright.config.ts`: already has `webServer` for Vite and two projects (`browser-smoke`, `tauri`), but its project `use` typing must be fixed before it counts as correct infrastructure.
- `justfile`: already routes runtime tests through `just test`; do not use a runtime result as app evidence before the suite has been judged correct and complete.

### Correct Type and Adapter Usage

Make the test suite ordinary correct TypeScript that uses the actual Tauri Playwright adapter surface.
This is a direct code/test repair task.

Tasks:

- Make the E2E test files part of normal TypeScript checking, using an ordinary test TypeScript config if the app config should continue to exclude tests.
- Fix `src/tests/playwright.config.ts` so project `use` blocks are typed through the plugin-supported shape, not `as any`.
- Type shared fixtures and helpers with `TauriPage`, `TestEnvironment`, and exact return types.
- Replace known IPC/config/session payload casts with exact response types or boundary parsers.
- Remove whole-file suppression from `src/tests/e2e/user-behaviors.spec.ts`.

Acceptance condition:

- The migrated E2E suite type-checks without `@ts-nocheck`, `as any`, unsupported adapter calls, fake globals, or loose known-payload casts.

### Repair Current Test Code

Remove the known noncompliant patterns from the migrated suite.

Tasks:

- `src/tests/playwright.config.ts`: remove `as any` around project `use` blocks by using the plugin-supported type surface or a local exact adapter type.
- `src/tests/e2e/user-behaviors.spec.ts`: remove `// @ts-nocheck`; type all fixtures and helpers with `TauriPage`, `TestEnvironment`, and explicit return types.
- `src/tests/e2e/desktop-file-workflows.spec.ts`: delete local `any`-typed `replaceEditorContents` and `previewText`; import the shared typed helpers from `editor-helpers.ts`; type remaining helper locators and string paths.
- `src/tests/e2e/file-selector.spec.ts`: delete the unused `cleanupDir` helper; remove the CJS `require()` and swallowed catch.
- `src/tests/e2e/settings.spec.ts`, `src/tests/e2e/command-parsing.spec.ts`, `src/tests/e2e/config-loading.spec.ts`, and `src/tests/e2e/session-persistence.spec.ts`: replace `as any` and loose known-payload casts with exact config/session/command-response types or boundary parsers.
- `src/tests/e2e/tikz-filter.spec.ts`: replace dependency skips with a prerequisite check that fails loudly before feature tests run, or make the proof use only dependencies that are declared hard requirements for this repo.
- `src/tests/e2e/app.spec.ts`: keep mocked IPC only as browser-smoke harness coverage; name and document it so it cannot be claimed as proof-obligation coverage.
- `src/tests/e2e/fixtures.ts`: keep cleanup failure handling only where the failure mode is explicit and inspected.
  Do not leave empty catches that hide diagnostics from unexpected process failures.

Acceptance condition:

- The active E2E files no longer contain the documented current failures above.

### Document Banned Patterns Durably

The docs and future reviews must reject these general patterns in `src/tests/`:

- whole-file type suppression: `// @ts-nocheck`, `// @ts-ignore`, or equivalent;
- `as any`, `: any`, and untyped helpers where a real app/test type is known;
- loose `Record<string, unknown>` assertions for known IPC/config/session payloads;
- CJS `require()` in ESM tests;
- empty, comment-only, or diagnostic-swallowing `catch` blocks;
- `test.skip`, conditional skips, xfails, or dependency-gated feature disappearance;
- `page.route(...)`, mocked Tauri `invoke`, synthetic IPC responses, or fake app state for feature proofs;
- browser-smoke mocked IPC counted as proof-obligation coverage;
- duplicated local helpers that weaken shared polling, typing, or boundary behavior;
- route-shape, JSON-shape, non-null, count-only, or “visible exists” assertions used as substitutes for exact user-visible outcomes;
- unsupported Playwright/Tauri adapter calls hidden behind type casts;
- tests that mutate expected behavior to match the current app instead of proving the documented behavior.

Acceptance condition:

- The banned-pattern list is explicit enough that a future reviewer can reject bad tests without inventing new policy or confusing mock/harness checks with feature proofs.

### Debug Failed Tests With Causal Evidence

A failing migrated test is not automatically an app bug.
It may be an app defect, an incorrect test, a Tauri Playwright adapter misuse, a fixture/config defect, a missing hard dependency, or an invalid proof shape.
Agents must classify the failure before changing code or tests.

For every failing test under repair, maintain a visible debugging note in the plan, a local scratchpad, or the PR description.
The note must include:

- exact command, project name, spec name, retry count, environment variables that affect the app, and whether this was a full run or a targeted run;
- complete Playwright stdout/stderr, console errors, Tauri/Rust stderr, renderer stderr, screenshots, traces, videos, test-results artifact paths, and relevant process tree observations;
- the proof obligation the test claims to model;
- the exact boundary where the first bad fact is observed: test setup, Tauri adapter launch, app startup, IPC command, config load, filesystem state, renderer process, DOM/editor state, preview iframe, or assertion;
- the expected contract at that boundary, sourced from repo docs, plugin docs, app code, or a known working test;
- the actual value or state at that boundary, inspected directly rather than inferred from the final assertion;
- competing hypotheses with falsifiers, including at least one app-defect hypothesis and at least one test/harness/proof-design hypothesis unless the stack trace mechanically proves the cause;
- the action taken after each observation, and which hypotheses it eliminated.

Use this classification before editing:

- **App defect:** the test correctly models a documented proof obligation, uses real objects and the supported adapter API, the fixture state is valid, and tracing shows the app violates the contract at the first bad boundary.
- **Incorrect test:** the asserted behavior contradicts AGENTS.md, `docs/testing-proof-obligations.md`, current architecture, a real data shape, or a working app pattern.
- **Harness misuse:** the failure comes from unsupported TauriPage/Playwright calls, browser-mode assumptions in Tauri mode, adapter lifecycle misuse, process cleanup confusion, or type escapes hiding the real adapter surface.
- **Fixture/config defect:** the test constructs impossible state, omits a required real dependency, relies on paths outside the temp workspace, uses stale XDG/HOME/session state, or asserts on fixture data rather than user-visible behavior.
- **Invalid proof design:** the test can pass without exercising the owned behavior, uses mocks for a feature proof, asserts only existence/shape, depends on arbitrary timing, or proves an obsolete Express/TikZJax/static-server contract.

Predicted weak-agent failure modes to block in review:

- increasing timeouts, adding retries, or rerunning the same command without a new observation;
- replacing user workflows with direct IPC because the UI is hard to drive;
- converting a real Tauri test to browser mode or mocked IPC to get a green result;
- changing expectations to match current broken app behavior;
- deleting, skipping, or narrowing a failing test and reporting the suite as improved;
- adding local helpers instead of fixing the shared typed helper;
- treating a final assertion timeout as the root cause without inspecting the first bad boundary;
- patching app code at the crash site before tracing the bad value back to its origin;
- swallowing console, renderer, or process errors to make output quieter;
- using `any`, `Record<string, unknown>`, broad optionals, or fake globals to make TypeScript stop objecting;
- inventing fallback behavior in app code so a malformed test fixture “works”;
- counting browser-smoke success, Rust helper success, or a targeted green spec as proof that the desktop proof burden is satisfied.

Stop rules:

- After two failed fix attempts on the same failing test, stop editing and write the causal ledger.
  The next action must be review of the ledger, not another patch.
- If the next proposed edit changes an assertion, timeout, skip, fixture shape, helper behavior, or adapter call, first write which classification it addresses and why that classification is established.
- If a test failure could be either app defect or test defect, add logging/inspection at the boundary that distinguishes them before changing either side.
- Do not remove diagnostic logging added during investigation until the causal case is written and the log no longer carries unique information.
- Do not claim a test is “fixed” unless the causal note states what was actually incorrect and why the new result proves that specific cause is gone.

### Core Proof Loop

Port the main E2E test: type markdown → verify preview iframe content.

- Source: `main:src/tests/e2e.spec.ts`
- Target: `src/tests/e2e/app.spec.ts` (replace current trivial test)
- Mode: `tauri` (needs IPC for render pipeline), `xvfb-run` suppresses window
- Key change: replace `frameLocator('#preview')` with `evaluate()` to read iframe content (TauriPage doesn't have frameLocator)

### Remaining Express-Suite Migration

Port every remaining old test file.
Each test may need:
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

### Remove Wrong-Layer Replacement Tests

Delete the 48 Rust tests that were created as replacement for the deleted E2E tests but test the wrong layer.

- Remove `render::tests` (5 tests, replaced by the core proof loop)
- Remove `command_flags::tests` (17 tests, utility parsing)
- Remove `commands::plugins::tests` (3 tests, utility interpolation)
- Remove `config::tests` (3 tests, config serialization)
- Remove `fs_utils::tests` (~19 tests, path utilities)

### Suite Correctness Audit

For every surviving E2E spec, add a short audit note or matrix entry recording:

- the proof obligation it models;
- the real objects it uses;
- the exact user-visible or disk/process outcome it asserts;
- the obsolete Express/mock/helper behavior it replaced;
- whether a plausible broken implementation would make the test fail.

Acceptance condition:

- Every feature-proof spec has an explicit proof claim and uses real Tauri IPC, real files, real temp workspaces, real config files, real renderer commands, real plugin commands, and real browser/editor interaction where that boundary is part of the behavior.

### Suite Coverage Audit

- Compare the migrated suite against `docs/testing-proof-obligations.md`.
- Identify proof obligations with no migrated test.
- Identify migrated tests that still prove obsolete Express behavior, browser-side TikZJax behavior, route-shape snapshots, or mock-only behavior.
- Mark the suite complete only when every required proof obligation is modeled by a real Tauri desktop test or is explicitly retired by current architecture docs.

Acceptance condition:

- `docs/testing-proof-obligations.md` has a corresponding real Tauri test, replacement proof, or explicit architecture-retirement note for every obligation.

### App Satisfaction

Run `just test` only after the type/adapter repair, correctness audit, and coverage audit say the suite is correct and complete.
At that point, failures are app or harness defects against the accepted proof burden, not evidence about whether the suite itself is complete.

## Risks / Rollback

- **Risk:** Some old tests depend on Express-specific helpers (e.g., `failing-renderer.mjs`, `window.__PANDOC_PREVIEW_STATE__`) that have no Tauri equivalent.
  **Mitigation:** Rewrite the test to use the Tauri mechanism for the same outcome.
  If the feature genuinely no longer exists, that's a migration gap — file an issue, don't silently exclude the test.
- **Risk:** `TauriPage.evaluate()` may not return iframe content correctly (CSP, cross-origin restrictions in the preview iframe).
  **Mitigation:** Test with simple evaluate call first.
  Fallback: extract preview content via `__PANDOC_PREVIEW_STATE__`-like mechanism if one exists, or add one.
- **Rollback:** All changes are forward-only (new files, no destructive edits to existing Rust code at first).
  If a test fails because the Tauri app actually lacks the feature, note the gap and move on — do not delete the test.

## Stop Rules

- Do not continue Express-suite migration work until the current non-admissible test patterns are corrected or explicitly quarantined as non-proof browser-smoke coverage.
- Do not remove wrong-layer Rust replacement tests until at least one real Tauri core proof-loop test exists and is admitted by the suite gates.

## Execution Progress

### Disk State

- [x] <!-- status: completed --> Shared Tauri Playwright infrastructure exists: `run-tauri-dev.sh`, `fixtures.ts`, `editor-helpers.ts`, and `tauri.e2e.conf.json`.
- [x] <!-- status: completed --> Ported or replacement E2E files exist under `src/tests/e2e/`, including proof-loop, settings, plugins, file workflows, diagnostics, command parsing, config loading, and academic rendering coverage.
- [x] <!-- status: completed --> Browser-smoke coverage exists as a harness check.
  It is not counted as proof of app functionality because it uses IPC mocks.
- [x] <!-- status: completed --> The obsolete browser-side TikZJax proof is not in the active E2E suite.

### Suite Completion Gates

- [ ] <!-- status: pending --> Historical suite inventory reconciled with current architecture.
- [ ] <!-- status: pending --> Current non-admissible test patterns are documented with file-level targets.
- [ ] <!-- status: pending --> Banned general test patterns are documented for future review.
- [ ] <!-- status: pending --> Failed-test debugging framework is documented and used before mutating app code, assertions, helpers, or fixtures.
- [ ] <!-- status: pending --> Test code is type-correct and uses the Tauri Playwright plugin/API properly.
- [ ] <!-- status: pending --> Feature proofs use real runtime objects and boundaries, not mocks or synthetic IPC/app state.
- [ ] <!-- status: pending --> Tests are vetted so a passing run would actually prove the behavior they claim.
- [ ] <!-- status: pending --> `docs/testing-proof-obligations.md` covered by migrated or replacement tests.
- [ ] <!-- status: pending --> Obsolete Express, MIME/static-server, central-figures-registry, route-interception, and browser-side TikZJax proof shapes removed or replaced.
- [ ] <!-- status: pending --> The suite is declared complete enough for `just test` to be meaningful as an app-satisfaction gate.
