# Complete E2E Suite Migration Gates

> **For Hermes:** Use subagent-driven-development skill to implement this plan phase by phase.

**Goal:** Satisfy all 10 suite-completion gates in `port-e2e-tests-from-main.md` so that `just test` is a meaningful app-satisfaction gate.

**Architecture:** Commit pending changes, run type-checking to identify remaining errors, fix test code file by file, audit each spec against banned patterns and obsolete proof shapes, cross-reference proof-obligation coverage, then run the suite end-to-end.

**Tech Stack:** TypeScript, Playwright, `@srsholmes/tauri-playwright`, Node.js, Rust/Tauri backend

---

## Current Defect

The `feature/tauri-first-architecture` branch has 21 staged files (docs, infrastructure, test repairs) and 2 unstaged files (`tsconfig.json`, `user-behaviors.spec.ts`) that have not been committed. The 10 suite-completion gates in the migration plan are all pending. Until the gates are satisfied, the test suite cannot be treated as a proof instrument, and `just test` cannot serve as an app-satisfaction gate.

## Target State

All 10 gates checked off. The E2E suite type-checks without `@ts-nocheck`, `as any`, unsupported adapter calls, or loose known-payload casts. Every spec uses real Tauri IPC boundaries. Banned patterns are documented and absent from the active suite. Proof obligations are covered. `just test` is meaningful when run.

## Constraints

- Required: Real Tauri IPC for feature proofs (tauri mode). Browser-smoke mocks only for `app.spec.ts` harness check.
- Forbidden: `@ts-nocheck`, `as any` (except narrow documented suppressions), `test.skip`, CJS `require()` in ESM, empty catch blocks, duplicated local helpers, mocked IPC for feature proofs.
- Approval gates: None. This is code/test repair, not architectural change.

## Prerequisites

- Access: Full read/write to repo on `feature/tauri-first-architecture` branch.
- Tools/environment: Node.js, npm, Tauri CLI, Pandoc, xvfb-run (confirmed available).
- External dependencies: None.

## Scope

- Included: All 19 E2E spec files in `src/tests/e2e/`, `playwright.config.ts`, `fixtures.ts`, `editor-helpers.ts`, `tsconfig.json`, proof-obligation coverage audit, banned-pattern file-level audit.
- Excluded: App-side behavior changes (separate phase, after gate 9 is satisfied). Rust code changes.

---

## Phases

### Phase 0: Commit Pending Changes

**Goal:** Get all pending staged and unstaged changes committed so the working tree is clean for subsequent audit and repair work.

#### Task 0.1: Commit unstaged tsconfig.json

- **Location:** `tsconfig.json`
- **Description:** Commit the change that removes `src/tests` from `exclude`. This enables type-checking of the E2E suite.
- **Dependencies:** None.
- **Acceptance criteria:** `tsconfig.json` no longer shows in `git diff`, commit message describes the change.
- **Validation:** `git diff tsconfig.json` produces empty output. `git log --oneline -1` shows the commit.

#### Task 0.2: Commit unstaged user-behaviors.spec.ts

- **Location:** `src/tests/e2e/user-behaviors.spec.ts`
- **Description:** Commit the type-safety refinements: `.poll()` timeout moved to poll options, `evaluate` calls converted to string-only API, `Buffer.from(pngBytes as number[])` cast fix, `isVisible()` timeout params dropped.
- **Dependencies:** None.
- **Acceptance criteria:** `user-behaviors.spec.ts` no longer shows in `git diff`.
- **Validation:** `git diff src/tests/e2e/user-behaviors.spec.ts` produces empty output.

#### Task 0.3: Commit the 21 staged files

- **Location:** All staged files
- **Description:** Commit the full documentation + infrastructure + test-repair overhaul as a single unit (already staged together).
- **Dependencies:** Tasks 0.1 and 0.2 must be committed first to separate concerns.
- **Acceptance criteria:** `git status` shows clean working tree.
- **Validation:** `git status --short` produces empty output.

### Phase 1: Gate 5 — Type-Correct Test Code

**Goal:** Make the E2E suite type-check without `@ts-nocheck`, `as any`, unsupported adapter calls, fake globals, or loose known-payload casts.

#### Task 1.1: Run initial type-check

- **Location:** `src/tests/`
- **Description:** Run `npx tsc --noEmit` now that `src/tests` is no longer excluded. Record every error.
- **Dependencies:** Phase 0 complete.
- **Acceptance criteria:** Full error list captured and categorized by file.
- **Validation:** Output of `npx tsc --noEmit` saved for reference.

#### Task 1.2: Fix type errors in test files (iterative)

- **Location:** Any E2E spec file with type errors from Task 1.1
- **Description:** For each file with type errors: identify the root cause (adapter API misuse, missing types, loose casts, `as any`, `@ts-nocheck`), fix with exact types from `@srsholmes/tauri-playwright` or boundary parsers. Track which files were touched.
- **Dependencies:** Task 1.1 complete.
- **Acceptance criteria:** `npx tsc --noEmit` produces zero errors on test code.
- **Validation:** `npx tsc --noEmit` exit code 0.

**Known pre-cleaned files** (staged fixes already applied, may still have residual errors):
- `playwright.config.ts` — `as any` removed via module augmentation
- `user-behaviors.spec.ts` — `@ts-nocheck` removed, types added, string-only `evaluate`
- `editor-helpers.ts` — centralized `saveViaFileSelector`
- `command-parsing.spec.ts` — camelCase invoke keys, loose payload casts tightened
- `settings.spec.ts` — loose payload casts tightened
- `desktop-file-workflows.spec.ts` — local any-typed helpers deleted, shared helpers imported
- `file-selector.spec.ts` — unused CJS `require()` cleanup helper deleted
- `tikz-filter.spec.ts` — dependency skips replaced with prerequisite Error throws
- `architectural-regression.spec.ts` — `previewInnerHTML` assertions converted to poll
- `proof-loop.spec.ts` — minor fixes

**Files NOT yet cleaned and likely to have type errors:**
- `app.spec.ts` — browser-smoke with mocked IPC (non-proof, allowed to use `any` in IPC mock, but must not leak casts into shared types)
- `bug-fixes.spec.ts` — may have residual casts or unsupported adapter calls
- `config-loading.spec.ts` — may have loose payload casts
- `diagram-workflow.spec.ts` — may have local helper issues
- `editor-height.spec.ts` — simple, but may have adapter issues
- `file-integrity.spec.ts` — may have evaluate/cast issues
- `mime-types.spec.ts` — may prove obsolete Express behavior; classify before fixing
- `plugins.spec.ts` — may have IPC payload casts
- `renderer-diagnostics.spec.ts` — may have adapter issues
- `session-persistence.spec.ts` — may have loose payload casts

### Phase 2: Gate 1 — Historical Suite Inventory Reconciled

**Goal:** Every spec file is classified: current-architecture proof, browser-smoke only, or obsolete-architecture artifact requiring replacement.

#### Task 2.1: Audit each spec file

- **Location:** All 19 files in `src/tests/e2e/`
- **Description:** For each spec, record: what it tries to prove, whether the proof shape targets current Tauri architecture or obsolete Express/TikZJax/MIME patterns, what banned patterns it contains (if any), and its disposition (valid as-is, needs repair, needs replacement, browser-smoke-only).
- **Dependencies:** Phase 1 complete (type errors must be known first).
- **Acceptance criteria:** Every spec has a disposition note in the plan.
- **Validation:** Cross-reference each file against the "Obsolete proof shapes" list in `docs/testing-proof-obligations.md`.

**Expected dispositions based on current knowledge:**

| File | Expected Disposition |
|------|---------------------|
| `app.spec.ts` | Browser-smoke only (mocked IPC). Not a feature proof. |
| `architectural-regression.spec.ts` | Valid, needs review for banned patterns |
| `bug-fixes.spec.ts` | Valid (cleaned of IPC-mock tests per handoff) |
| `command-parsing.spec.ts` | Valid (camelCase invoke keys fixed) |
| `config-loading.spec.ts` | Valid, needs review for payload casts |
| `desktop-file-workflows.spec.ts` | Valid (local helpers removed) |
| `desktop-smoke.spec.ts` | Browser-smoke only |
| `diagram-workflow.spec.ts` | Valid, needs review |
| `editor-height.spec.ts` | Valid, needs review |
| `file-integrity.spec.ts` | Valid, needs review |
| `file-selector.spec.ts` | Valid (CJS require removed) |
| `mime-types.spec.ts` | **Suspicious** — MIME detection was Express-era. Classify carefully. |
| `plugins.spec.ts` | Valid, needs review |
| `proof-loop.spec.ts` | Valid (core proof) |
| `renderer-diagnostics.spec.ts` | Valid, needs review |
| `session-persistence.spec.ts` | Valid, needs review |
| `settings.spec.ts` | Valid (payload casts tightened) |
| `tikz-filter.spec.ts` | Valid (dependency skips replaced with Error) |
| `user-behaviors.spec.ts` | Valid (type safety applied) |

### Phase 3: Gate 2 — Non-Admissible Patterns Documented with File-Level Targets

**Goal:** For each spec file, document which banned patterns exist (if any), or confirm the file is clean.

#### Task 3.1: Create per-file banned-pattern ledger

- **Location:** This plan document or a durable appendix
- **Description:** For each spec file, record: banned patterns found (with line references), whether they've been fixed, or confirm the file is clean. Use the banned-pattern list from the plan as the checklist.
- **Dependencies:** Phase 2 complete (know each file's disposition).
- **Acceptance criteria:** Every file has an entry. Clean files confirmed. Dirty files have specific pattern + line references.
- **Validation:** Grep each file for banned pattern signatures (`@ts-nocheck`, `as any`, `require(`, `test.skip`, `catch {`, `page.route`, `frameLocator`).

### Phase 4: Gate 3 — Banned General Test Patterns Documented for Future Review

**Goal:** The banned-pattern list is durable and complete.

#### Task 4.1: Verify banned-pattern list completeness

- **Location:** `docs/testing-proof-obligations.md` section "Banned Test Patterns"
- **Description:** Cross-reference the banned-pattern list against the plan's list and AGENTS.md testing rules. Verify no gaps. The list in `docs/testing-proof-obligations.md` and the plan are already extensive; this task confirms they agree and don't miss anything.
- **Dependencies:** None (documentation-only).
- **Acceptance criteria:** The two banned-pattern lists are consistent. Any gap is resolved.
- **Validation:** Diff the two lists. Confirm both cover: type suppression, `as any`, loose casts, CJS require, empty catches, test.skip, route mocking, mocked IPC, browser-smoke mislabeling, duplicated helpers, shape-only assertions, unsupported adapter calls, expectation-mutation.

### Phase 5: Gate 4 — Failed-Test Debugging Framework Documented

**Goal:** The debugging contract from the plan is durable and referenced from testing docs.

#### Task 5.1: Confirm debugging framework is documented

- **Location:** `docs/testing-proof-obligations.md` section "Failed-Test Debugging Contract" and plan section "Debug Failed Tests With Causal Evidence"
- **Description:** Verify the debugging framework (classification categories, causal note requirements, stop rules, predicted failure modes) is fully documented and consistent between the two documents.
- **Dependencies:** None (documentation-only).
- **Acceptance criteria:** Both documents have the same 5 classification categories, causal note structure, and stop rules.
- **Validation:** Compare the two sections. Confirm no drift.

### Phase 6: Gate 6 — Feature Proofs Use Real Runtime Objects

**Goal:** Verify every spec that claims to prove app behavior actually uses real Tauri IPC, real files, real config, and real renderer paths (not mocks).

#### Task 6.1: Audit real-object usage per spec

- **Location:** All 19 spec files (excluding browser-smoke files)
- **Description:** For each feature-proof spec, confirm: uses `mode: 'tauri'` (not browser), uses `appPage`/`tauriPage` from fixture (not raw `page`), uses real filesystem paths from `testEnv`, uses real config writes, uses real IPC invocations (not mocked), uses real editor/preview interaction for content verification.
- **Dependencies:** Phase 2 complete (dispositions known).
- **Acceptance criteria:** Every non-browser-smoke spec confirmed to use real objects. Any spec using mocks for a feature claim is flagged.
- **Validation:** Grep each spec for `page.route`, mocked `invoke`, `addInitScript`, `browser-smoke`, `mode: 'browser'` (in non-smoke files), direct `page` usage without Tauri fixture.

### Phase 7: Gate 7 — Tests Vetted So Passing Run Proves Behavior

**Goal:** For each feature-proof spec, verify that the assertions would actually catch a broken implementation. Remove or strengthen shape-only assertions.

#### Task 7.1: Vet assertions per spec

- **Location:** Each feature-proof spec file
- **Description:** For each spec, review every assertion. Question: if the app were broken in the way this test claims to guard, would this assertion fail? Replace: shape-only checks (`toBeTruthy()`, `not.toBeNull()`), count-only checks, substring existence without semantic meaning. Replace with exact observable outcomes.
- **Dependencies:** Phase 6 complete (real objects confirmed).
- **Acceptance criteria:** Every assertion in feature-proof specs targets an exact observable outcome. No assertion passes on a subtly broken app.
- **Validation:** For each spec, identify at least one plausible broken-app scenario and confirm the test would catch it.

### Phase 8: Gate 8 — Proof Obligations Covered

**Goal:** Every proof obligation in `docs/testing-proof-obligations.md` is modeled by a corresponding real Tauri test, a planned replacement test, or an explicit architecture-retirement note.

#### Task 8.1: Create coverage matrix

- **Location:** This plan document
- **Description:** Map each proof obligation from `docs/testing-proof-obligations.md` to either: (a) a specific spec file + test name that covers it, (b) a planned replacement (with issue reference), or (c) an explicit retirement note explaining why the obligation is no longer applicable under the current architecture.
- **Dependencies:** Phase 2 and Phase 7 complete (know what each test actually proves).
- **Acceptance criteria:** Every P0 obligation has a coverage entry. Gaps have either a planned replacement or a retirement note.
- **Validation:** Produce a table mapping obligation → coverage status.

#### Task 8.2: File issues for coverage gaps

- **Location:** This repo's GitHub issues
- **Description:** For any P0 obligation without a current test and without a valid retirement reason, file a GitHub issue describing the missing coverage.
- **Dependencies:** Task 8.1 complete.
- **Acceptance criteria:** Zero unaddressed P0 coverage gaps. All gaps have either a test, an issue, or a documented retirement.
- **Validation:** Coverage matrix shows no "missing" entries in the P0 section.

### Phase 9: Gate 9 — Obsolete Proof Shapes Removed or Replaced

**Goal:** No active test proves obsolete Express/MIME/central-figures/tikzjax/route-interception/timing-theater behavior.

#### Task 9.1: Classify and remove obsolete tests

- **Location:** Any spec proving obsolete behavior
- **Description:** For each spec flagged in Phase 2 as proving obsolete behavior: either replace with a current-architecture equivalent or delete. Key targets:
  - `mime-types.spec.ts` — MIME detection was Express-era. If the Tauri app has no MIME boundary, delete it.
  - Any test using `page.route(...)` — remove or rewrite with real failure reproduction.
  - Any timing-theater assertion — replace with causality proof.
- **Dependencies:** Phase 2 complete (obsolete flags known).
- **Acceptance criteria:** No active feature-proof test proves Express, MIME, central-figures, tikzjax, route-interception, or timing-theater behavior.
- **Validation:** Grep for obsolete patterns: `page.route`, `mime`, `tikzjax`, `central.*figures`, timing constants without causality.

### Phase 10: Gate 10 — Suite Declared Complete

**Goal:** After gates 1-9 are satisfied, the suite is declared complete enough for `just test` to be meaningful.

#### Task 10.1: Final checklist

- **Location:** All gates
- **Description:** Confirm every gate is satisfied. Check off each gate in the plan.
- **Dependencies:** Gates 1-9 complete.
- **Acceptance criteria:** All 10 gates checked off.
- **Validation:** Each gate has explicit evidence (type-check output, audit notes, coverage matrix, etc.).

#### Task 10.2: Run just test

- **Location:** `just test`
- **Description:** Run the full test pipeline: agent contracts check → type-check → Rust unit tests → Playwright E2E suite (browser-smoke + tauri).
- **Dependencies:** Task 10.1 complete.
- **Acceptance criteria:** `just test` runs to completion. Any failures are classified as app defects per the debugging framework.
- **Validation:** `just test` output. Classify each failure (app defect vs. harness issue vs. test correctness issue).

---

## System-Level Validation

- End-to-end check: `just test` passes or produces classified failures only (no suite-correctness failures).
- Real-use smoke check: At least the core proof loop test (`proof-loop.spec.ts`) passes in tauri mode with xvfb.

## Risks / Rollback

- **Risk:** `npx tsc --noEmit` reveals dozens of type errors that require deep understanding of the Tauri Playwright plugin surface.
  - **Mitigation:** Each error is a discrete fix. Prioritize by file; fix shared types (`fixtures.ts`, `editor-helpers.ts`) first since they cascade.
- **Risk:** `mime-types.spec.ts` or another spec proves obsolete behavior but replacing it requires app-side changes.
  - **Mitigation:** Delete or quarantine the spec with an issue filed. Gate 9 allows removal without replacement when the architecture forbids the old behavior.
- **Risk:** Running `just test` in tauri mode requires xvfb, Pandoc, and other real dependencies that may not produce clean output.
  - **Mitigation:** Run a targeted test first (`proof-loop.spec.ts`) before the full suite. Failures in prerequisite setup are not app defects.
- **Rollback:** All changes are forward-only commits. Revert via `git revert` if needed.

## Stop Rules

- Do not proceed to Phase 1 if Phase 0 commits cannot be made cleanly.
- Do not proceed to Phase 2 if `npx tsc --noEmit` has unfixed errors.
- Do not proceed to Phase 7 if any feature-proof spec has been confirmed to use mocks (gate 6 blocker).
- After two failed fix attempts on the same type error or test failure, stop and write a causal note per the debugging framework. Do not keep patching.
- Do not claim the suite is complete (gate 10) if any P0 proof obligation lacks coverage.

---

## Execution Progress

### Phase 0: Commit Pending Changes

- [ ] Task 0.1: Commit unstaged tsconfig.json
- [ ] Task 0.2: Commit unstaged user-behaviors.spec.ts refinements
- [ ] Task 0.3: Commit the 21 staged files (docs + infrastructure + test repairs)

### Phase 1: Gate 5 — Type-Correct Test Code

- [ ] Task 1.1: Run `npx tsc --noEmit` and record all errors
- [ ] Task 1.2: Fix type errors file by file until zero errors remain

### Phase 2: Gate 1 — Historical Suite Inventory Reconciled

- [ ] Task 2.1: Audit each of 19 spec files (disposition + obsolete shape check)

### Phase 3: Gate 2 — Non-Admissible Patterns Documented with File-Level Targets

- [ ] Task 3.1: Create per-file banned-pattern ledger

### Phase 4: Gate 3 — Banned General Test Patterns Documented

- [ ] Task 4.1: Verify banned-pattern list completeness and consistency

### Phase 5: Gate 4 — Failed-Test Debugging Framework Documented

- [ ] Task 5.1: Confirm debugging framework is documented and consistent

### Phase 6: Gate 6 — Feature Proofs Use Real Runtime Objects

- [ ] Task 6.1: Audit real-object usage per spec

### Phase 7: Gate 7 — Tests Vetted for Proof Quality

- [ ] Task 7.1: Vet assertions per spec

### Phase 8: Gate 8 — Proof Obligations Covered

- [ ] Task 8.1: Create coverage matrix (obligation → test mapping)
- [ ] Task 8.2: File issues for coverage gaps

### Phase 9: Gate 9 — Obsolete Proof Shapes Removed

- [ ] Task 9.1: Classify and remove/replace obsolete tests

### Phase 10: Gate 10 — Suite Declared Complete

- [ ] Task 10.1: Final checklist — confirm all 9 prior gates satisfied
- [ ] Task 10.2: Run `just test`, classify all failures

### System-Level Validation

- [ ] `just test` produces classified failures only (no suite-correctness failures)
- [ ] Core proof loop test passes in tauri mode
