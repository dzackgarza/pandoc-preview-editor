# Suite Inventory — 4 Active E2E Spec Files

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-06
**Status:** **Consolidated / Incomplete**

**Note:** Previous versions of this inventory claimed 19 files. This was inaccurate. The suite has been consolidated into 4 major "workflow" specs. 15 historical files from the Express-era migration are currently missing or merged into these workflows.

---

## Active Tauri Proofs (Real IPC)

### 1. `workflow-config.spec.ts`
- **Goal:** Exercises config lifecycle: creation, UI preferences, raw command parsing, and persistence.
- **Covers:** `config-loading.spec.ts`, `settings.spec.ts`, `command-parsing.spec.ts`.
- **Status:** **Failing (101 Panic)**.

### 2. `workflow-editing.spec.ts`
- **Goal:** Exercises full session: launch, edit, save, navigate, save-as, reload, and recovery.
- **Covers:** `file-integrity.spec.ts`, `desktop-file-workflows.spec.ts`, `session-persistence.spec.ts`.
- **Status:** **Failing (101 Panic)**.

### 3. `workflow-diagnostics.spec.ts`
- **Goal:** Exercises renderer error capture, diagnostics display, and recovery.
- **Covers:** `renderer-diagnostics.spec.ts`.
- **Status:** **Failing (101 Panic)**.

### 4. `workflow-extensions.spec.ts`
- **Goal:** Exercises plugins, diagram creation, image pasting, and filter rendering.
- **Covers:** `plugins.spec.ts`, `diagram-workflow.spec.ts`, `tikz-filter.spec.ts`, `user-behaviors.spec.ts`.
- **Status:** **Failing (101 Panic)**.

---

## Missing / Reconciled Files (Historical Inventory)

The following files from `main` (Express-era) are not present in `src/tests/e2e/` and their behavior is only partially covered by the consolidated workflows above:

1. `app.spec.ts` (Missing - intended as browser-smoke)
2. `desktop-smoke.spec.ts` (Missing)
3. `editor-height.spec.ts` (Missing)
4. `proof-loop.spec.ts` (Missing - critical torture-document proof)
5. `mime-types.spec.ts` (Missing)
6. `architectural-regression.spec.ts` (Missing)
7. `bug-fixes.spec.ts` (Missing)
8. `file-selector.spec.ts` (Missing)

## Summary

The suite is **Incomplete**. Several critical proof obligations (especially the `proof-loop` torture document) are currently not exercised by any active test. The inventory claims of "Covered" in `obligation-coverage.md` must be re-verified against the actual consolidated content.
