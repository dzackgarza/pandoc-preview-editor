---
title: tauri-first-architecture handoff
tags: [handoff, state, tauri, e2e, pandoc-preview]
date: 2026-06-04
---

# tauri-first-architecture Branch Handoff

This memory records the branch state, in-flight work, and next actions for
`feature/tauri-first-architecture` as of 2026-06-04.

## Branch identity

- **Branch**: `feature/tauri-first-architecture`, 37 commits ahead of `main`
- **Worktree**: `/home/dzack/gitclones/pandoc-preview-tauri`
- **Last commit**: `08d2384` — "Remove diagnostic cruft from UnsavedChangesDialog test; replace Playwright .click() with native click for file entries"
- **Predecessor branch**: `feature/file-integrity` (committed and merged into this branch)

## What is structurally complete (committed)

- Express server deleted; Tauri v2 backend in `src-tauri/src/commands/` with modules: config, document, diagram, figures, filters, plugins, zotero
- Client migrated from Express `fetch()` to Tauri `invoke()` IPC
- Render command parsing consolidated into single Rust-owned parser (`command_flags.rs`)
- 19 E2E test files ported to `src/tests/e2e/`:
  `app.spec.ts`, `architectural-regression.spec.ts`, `bug-fixes.spec.ts`,
  `command-parsing.spec.ts`, `config-loading.spec.ts`, `desktop-file-workflows.spec.ts`,
  `desktop-smoke.spec.ts`, `diagram-workflow.spec.ts`, `editor-height.spec.ts`,
  `file-integrity.spec.ts`, `file-selector.spec.ts`, `mime-types.spec.ts`,
  `plugins.spec.ts`, `proof-loop.spec.ts`, `renderer-diagnostics.spec.ts`,
  `session-persistence.spec.ts`, `settings.spec.ts`, `tikz-filter.spec.ts`,
  `user-behaviors.spec.ts`
- Browser-smoke harness exists (`desktop-smoke.spec.ts` / `app.spec.ts` with mocked IPC) — explicitly NOT counted as feature proof
- 48 Rust utility tests deleted as wrong-layer replacements (only 3 `fs_utils` path tests remain)
- Tauri Playwright infrastructure exists: `run-tauri-dev.sh` (xvfb-wrapped), `fixtures.ts`, `editor-helpers.ts`, `tauri.e2e.conf.json`
- TikZJax retired — AGENTS.md explicitly forbids in-browser TikZ rendering
- Diagram tool registry unified into shared JSON data file (`src/shared/diagram-tools.json`)

## What is staged (uncommitted, 21 files)

A documentation + infrastructure + test-repair overhaul:

- **Docs rewritten**: AGENTS.md expanded 4x, `docs/testing-proof-obligations.md` rewritten, `REPORT.md` updated, `TODO.md` updated
- **Plan rewritten**: `.agents/plans/port-e2e-tests-from-main.md` now separates suite-correctness, proof-obligation coverage, and app-satisfaction as distinct phases. All 10 suite-completion gates are explicitly pending.
- **Pre-commit hook**: `.githooks/pre-commit` runs `just _agent-contracts-staged` + `just _typecheck`
- **New infra script**: `scripts/check-agent-contracts.mjs`
- **justfile changes**: `test` recipe now depends on `_agent-contracts` + `_typecheck`; old `test-rust`/`test-verbose` made private
- **Test repairs**:
  - `playwright.config.ts`: `as any` removed via module augmentation for `mode` option
  - `user-behaviors.spec.ts`: `@ts-nocheck` removed, types added to all helpers and fixtures
  - `editor-helpers.ts`: `saveViaFileSelector` centralized (was duplicated in multiple specs)
  - `file-selector.spec.ts`: unused CJS `require()` cleanup helper deleted
  - `tikz-filter.spec.ts`: dependency skips addressed
  - `desktop-file-workflows.spec.ts`: local any-typed helpers removed, shared helpers imported
  - `settings.spec.ts`, `command-parsing.spec.ts`: loose payload casts tightened

## What is unstaged (2 files)

- `tsconfig.json`: removes `src/tests` from `exclude` — **critical**. Without this, the pre-commit hook's `just _typecheck` cannot type-check the E2E suite. The hook becomes a no-op on test code.
- `user-behaviors.spec.ts`: additional fixes — `.poll()` signatures corrected (timeout moved from assertion to poll options), `evaluate` calls converted to string-only API, `Buffer.from(pngBytes as number[])` cast fix, `isVisible()` timeout params dropped

## Plan gates (all pending)

The plan in `.agents/plans/port-e2e-tests-from-main.md` lists 10 suite-completion gates, none checked:

1. Historical suite inventory reconciled with current architecture
2. Non-admissible test patterns documented with file-level targets
3. Banned general test patterns documented for future review
4. Failed-test debugging framework documented and used
5. Test code is type-correct and uses Tauri Playwright plugin properly
6. Feature proofs use real runtime objects and boundaries
7. Tests vetted so a passing run would actually prove claimed behavior
8. `docs/testing-proof-obligations.md` covered by migrated or replacement tests
9. Obsolete Express/MIME/central-figures/tikzjax proof shapes removed
10. Suite declared complete enough for `just test` to be meaningful

## Next actions (recommended order)

1. Commit the unstaged `tsconfig.json` change first — it's a standalone fix that enables type-checking of test code
2. Commit the unstaged `user-behaviors.spec.ts` refinements — completes the type-safety work on that file
3. Run `just test` (or equivalently `npx tsc --noEmit` on the test suite) to see how many type errors remain in the E2E tests now that they're included
4. Address remaining type errors / banned patterns file by file per the plan's "Repair Current Test Code" section
5. Only after gates 1-9 are satisfied: run `just test` as app-satisfaction evidence

## Key documents to read on reentry

- `.agents/plans/port-e2e-tests-from-main.md` — the active plan with all gates
- `docs/testing-proof-obligations.md` — defines the behavior burden the suite must prove
- `AGENTS.md` — app philosophy, hard boundaries, testing rules
- `TODO.md` — current task list
- `REPORT.md` — architecture report and testing sequence
