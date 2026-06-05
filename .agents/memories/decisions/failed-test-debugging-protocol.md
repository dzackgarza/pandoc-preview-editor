# Decision: Failed-Test Debugging Protocol

**Date:** 2026-06-06
**Status:** **Active**
**Source:** `.agents/audits/debugging-framework.md`

This protocol is mandatory for all responses to test failures in the `pandoc-preview` repository. It enforces systematic, evidence-based debugging over "guess-and-patch" behavior.

---

## Step 1: Classify the First Incorrect Boundary

Every failure must be classified into exactly one of these categories BEFORE any mutation:

### A. App Defect
The test correctly models a documented proof obligation, uses the real plugin boundary, and the app violates the contract.

### B. Incorrect Test
The test asserts behavior contradicted by `AGENTS.md`, `docs/testing-proof-obligations.md`, real data shape, or current architecture.

### C. Plugin/API Misuse
The test uses generic Playwright APIs not exposed by `TauriPage`, uses browser-mode assumptions in Tauri mode, or type-escapes the adapter.

### D. Fixture/Config Defect
The test builds impossible temp state, leaks HOME/XDG/session state, omits a hard dependency, or asserts on fixture setup instead of app behavior.

### E. Invalid Proof Design
The test can pass without proving the owned behavior, uses mocks for a feature proof, asserts shape/existence only, depends on arbitrary timing, or preserves obsolete Express/TikZJax/static-server behavior.

---

## Step 2: Write Causal Note

Every failed-test repair must leave a visible causal note containing:
- Exact command, project, spec, environment, and retry count.
- Playwright stdout/stderr, browser console, Tauri/Rust stderr, renderer stderr.
- The proof obligation under test.
- The first boundary where actual state diverges from expected state.
- Competing hypotheses and the observation that eliminated each one.
- Why the final edit fixes the established cause rather than making the test easier to pass.

---

## Step 3: Stop Rules

- **Two-Failure Limit**: After two failed fix attempts on the same test, stop editing and review the causal note.
- **No Suppression**: Converting a hard failure (`panic!`) into a soft warning (`log::warn!`) is a bridge-burning violation and is strictly forbidden. Fix the environment or the source, never the signal.
