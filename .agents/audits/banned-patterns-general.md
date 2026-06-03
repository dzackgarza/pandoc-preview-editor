# Banned Test Patterns — General

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-03
**Purpose:** Gate 3 — documented banned patterns consistent with `docs/testing-proof-obligations.md`.

This document enumerates each banned pattern class, the rationale, and verification that it is absent from the active suite (or present only with documented justification). It must remain consistent with `docs/testing-proof-obligations.md` "Banned Test Patterns" section.

---

## Pattern Classes

### 1. Whole-file type suppression
- **Pattern:** `// @ts-nocheck`, `// @ts-ignore`
- **Rationale:** Defeats all static analysis; hides real type errors.
- **Status:** Zero instances. Verified by `rg '@ts-nocheck\|@ts-ignore' src/tests/e2e/`.
- **Consistent with proof-obligations.md:** Yes.

### 2. `as any` / `: any`
- **Pattern:** Type assertions that widen to `any`.
- **Rationale:** Masks real type errors; prevents refactoring safety.
- **Acceptable exceptions:** Narrow documented casts for upstream library type gaps (e.g., `js-toml` returning `unknown`, `PageLike` unexported from plugin).
- **Status:** 9 instances across 4 files, all documented in `banned-patterns-by-file.md`. Zero unexamined.
- **Consistent with proof-obligations.md:** Yes — "as any, : any, and untyped helpers where a real app/test type is known" — all instances are where the upstream type is NOT known/exported.

### 3. Loose `Record<string, unknown>` assertions
- **Pattern:** Asserting shape only (`typeof`, non-null) instead of exact values for known payloads.
- **Rationale:** Does not prove behavior; would pass if the app returned wrong-but-shaped data.
- **Status:** Some IPC responses are typed as `Record<string, unknown>` at the invoke boundary (Tauri IPC returns untyped JSON). Exact value assertions follow each invoke. No test relies solely on shape checks.
- **Consistent with proof-obligations.md:** Yes — assertions name exact outcomes (disk paths, file contents, preview text, UI presence, exit codes).

### 4. CJS `require()` in ESM
- **Pattern:** `const fs = require('fs')` in ESM modules.
- **Rationale:** Mixes module systems; breaks static analysis.
- **Status:** Zero instances. All imports use ESM `import` syntax.
- **Consistent with proof-obligations.md:** Yes.

### 5. Empty/diagnostic-swallowing `catch` blocks
- **Pattern:** `catch {}`, `catch (_) {}`, `catch (e) { /* ignore */ }`.
- **Rationale:** Silences failures; hides root causes.
- **Status:** Zero instances.
- **Consistent with proof-obligations.md:** Yes.

### 6. `test.skip` / conditional skips / xfails
- **Pattern:** Tests that never run or only run conditionally — used to hide failures.
- **Rationale:** A skipped test proves nothing.
- **Acceptable exception:** `app.spec.ts:6` — `test.skip` gates the browser-smoke test to the `browser-smoke` Playwright project only. This is an architectural gate, not a failure-hiding mechanism.
- **Status:** Single instance at `app.spec.ts:6`, acceptable.
- **Consistent with proof-obligations.md:** Yes — "test.skip, conditional skips, xfails, or dependency-gated feature disappearance" — the browser-smoke gate is architectural, not evasive.

### 7. `page.route(...)` / mocked IPC / synthetic responses
- **Pattern:** Playwright route interception or Tauri `invoke` mocking for feature proofs.
- **Rationale:** A mock proves nothing about the real app.
- **Status:** Zero instances outside `app.spec.ts` (where mocks are explicitly declared for the browser-smoke harness check).
- **Consistent with proof-obligations.md:** Yes.

### 8. Browser-smoke mocks counted as proof-obligation coverage
- **Pattern:** Counting `app.spec.ts` as satisfying a feature-proof obligation.
- **Rationale:** Browser-smoke proves the React shell mounts; it does not prove Tauri IPC, filesystem, renderer, plugin, config, save, recovery, or workspace behavior.
- **Status:** `app.spec.ts` is labeled as browser-smoke only. No obligation claims it as coverage.
- **Consistent with proof-obligations.md:** Yes.

### 9. Duplicated local helpers
- **Pattern:** Copying a helper function from `editor-helpers.ts` into a spec with local modifications.
- **Rationale:** Weakens the shared boundary; diverges behavior across specs.
- **Status:** Zero instances. All specs import from `./editor-helpers.js`. Local `test.extend` setups and inline helpers are unique to each spec's fixture needs, not copies of shared helpers.
- **Consistent with proof-obligations.md:** Yes.

### 10. Route-shape / JSON-shape / non-null / count-only / "visible exists" assertions
- **Pattern:** Assertions that prove only structure or existence, not correctness.
- **Rationale:** A non-null check does not prove the value is correct.
- **Status:** The suite uses exact assertions: disk paths (`toHaveAttribute('title', exactPath)`), file contents (`toBe(exactMarkdown)`), preview text (`toContain('specific heading')`), TOML values (`parsedToml.render.debounce_ms).toBe(200)`), and UI state (`toContainText('saved')`). No assertion relies solely on non-null or shape checks.
- **Consistent with proof-obligations.md:** Yes.

### 11. Timing-theater assertions
- **Pattern:** Tests that prove only that something happened within a timeout, without proving the causal chain.
- **Rationale:** A timing-based test can pass for the wrong reason (e.g., stale data, cached response, race condition).
- **Status:** The suite uses `expect.poll` for asynchronous state (debounced renders, file writes). Polls assert exact content, not just existence. Timeouts are upper bounds, not the proof mechanism. No test depends solely on timing.
- **Consistent with proof-obligations.md:** Yes.

### 12. Express / MIME / tikzjax / central-figures / route-interception references
- **Pattern:** Tests that prove behavior of removed architecture components.
- **Rationale:** Proving Express routing, MIME-type handling, central-figure registry, or in-browser tikzjax proves nothing about the current Tauri architecture.
- **Status:** Zero active instances. `tikz-filter.spec.ts` explicitly asserts AGAINST tikzjax (negative proof). `mime-types.spec.ts` is misnamed — content tests asset loading, not MIME types.
- **Consistent with proof-obligations.md:** Yes.

---

## Verification

- `rg '@ts-nocheck'` — zero
- `rg 'test.skip'` — single instance at `app.spec.ts:6`
- `rg 'require\('` — zero
- `rg 'catch\s*\{'` — zero empty catch blocks
- `rg 'page\.route'` — zero
- `rg 'tikzjax'` — only negative assertion in `tikz-filter.spec.ts`
- `npx tsc --noEmit` — zero errors

This document is consistent with `docs/testing-proof-obligations.md` "Banned Test Patterns" section.
