# Failed-Test Debugging Framework

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-03
**Purpose:** Gate 4 — framework to follow before any code mutation in response to test failure.

This framework is derived from the Tauri Playwright Plugin Testing rules in `AGENTS.md`,
the `systematic-debugging` skill, and repo-specific failure patterns observed during migration.

---

## Step 0: Preserve Evidence

Before ANY action on a failing test:

```bash
git add -A && git commit -m "checkpoint: before debugging <test-name>"
```

Do not edit, skip, or comment out any test without this checkpoint.

---

## Step 1: Classify the First Incorrect Boundary

Every failure must be classified into exactly one of these categories BEFORE any mutation:

### A. App Defect
The test correctly models a documented proof obligation, uses the real plugin boundary,
and the app violates the contract.

**Evidence required:**
- The proof obligation under test (from `docs/testing-proof-obligations.md` or suite inventory).
- The exact assertion that fails.
- Why the assertion is correct given the current architecture.

### B. Incorrect Test
The test asserts behavior contradicted by `AGENTS.md`, `docs/testing-proof-obligations.md`,
real data shape, or current architecture.

**Evidence required:**
- The specific doc line(s) the test contradicts.
- The correct behavior per architecture.
- Why the test must change (not the app).

### C. Plugin/API Misuse
The test uses generic Playwright APIs not exposed by `TauriPage`, uses browser-mode
assumptions in Tauri mode, or type-escapes the adapter.

**Evidence required:**
- The unsupported API call with `dist/index.d.ts` line showing it's absent.
- The correct `TauriPage` API to use instead (if any).

### D. Fixture/Config Defect
The test builds impossible temp state, leaks HOME/XDG/session state, omits a hard
dependency, or asserts on fixture setup instead of app behavior.

**Evidence required:**
- The specific fixture/config state that is wrong.
- The correct state per the test's intent.

### E. Invalid Proof Design
The test can pass without proving the owned behavior, uses mocks for a feature proof,
asserts shape/existence only, depends on arbitrary timing, or preserves obsolete
Express/TikZJax/static-server behavior.

**Evidence required:**
- Why the test would pass even if the app behavior is broken.
- The correct proof design.

---

## Step 2: Write Causal Note

Every failed-test repair must leave a visible causal note containing:

- Exact command, project, spec, environment, and retry count.
- Playwright stdout/stderr, browser console, Tauri/Rust stderr, renderer stderr,
  screenshots/traces/videos, and relevant artifact paths.
- The proof obligation under test.
- The first boundary where actual state diverges from expected state (from Step 1).
- Competing hypotheses and the observation that eliminated each one.
- Why the final edit fixes the established cause rather than making the test easier to pass.

---

## Step 3: Mutation Rules

After classification (Step 1) and causal note (Step 2):

1. **App defect (A):** File an issue with the causal note. Do NOT fix the app in this migration phase.
   The migration contract forbids Rust/app-behavior changes.

2. **Incorrect test (B):** Fix the test AFTER committing the causal note as a checkpoint.
   The fix must be a forward edit, not a reversion.

3. **Plugin/API misuse (C):** Fix the API call. If no `TauriPage` API exists for the need,
   file an issue.

4. **Fixture/Config defect (D):** Fix the fixture state. Verify with a re-run.

5. **Invalid proof design (E):** Rewrite the test to prove the owned behavior.
   If the behavior is no longer owned (architecture change), file an issue and document
   the retirement in `docs/testing-proof-obligations.md`.

---

## Step 4: Two-Failure Limit

After two failed fix attempts on the same test, stop editing and review the causal note.
Do not keep patching assertions, helpers, fixture setup, adapter calls, or timeouts
without a new observation that changes the diagnosis.

---

## Evidence Collection Commands

```bash
# Full test run with artifacts
just test 2>&1 | tee test-output.log

# Single spec with verbose output
npx playwright test --config=src/tests/playwright.config.ts src/tests/e2e/<spec> --reporter=list

# TypeScript check
npx tsc --noEmit
```

---

## Integration with Gate 10

When `just test` runs for Gate 10, every failure must carry a classification
from Step 1 in this framework. Failures classified as `B` (incorrect test) or
`E` (invalid proof design) are suite-correctness failures and block gate completion.
Failures classified as `A` (app defect), `C` (plugin misuse), or `D` (fixture/harness)
are not suite-correctness failures but must be documented with issues filed.
