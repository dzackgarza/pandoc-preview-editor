# Banned Patterns — Per-File Ledger

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-04
**Purpose:** Gate 2 — every `as any` / `test.skip` instance with exact file:line target.

`as any` in spec files: 1 (`fixtures.ts`, PageLike TS4023). Library-gap `as any` lives in `editor-helpers.ts` (allowedMockFile) inside typed wrappers (`parseToml`, `getPandocFilters`).

Typed wrappers in `editor-helpers.ts` (`parseToml`, `getPandocFilters`) eliminate
`as any` from spec files. The single remaining instance is an upstream type defect.

## Active instances

### `src/tests/e2e/fixtures.ts:268`
- **Pattern:** `export const expect = base.expect as any;`
- **Justification:** `@srsholmes/tauri-playwright` v0.2.2 does not export the `PageLike` interface used in its `Expect<>` matchers (`toHaveURL`, `toHaveTitle`). Re-exporting `base.expect` triggers TS4023. The runtime value is correct; `as any` widens to avoid the declaration-emit blocker.
- **Status:** Documented. Upstream package defect.

### `src/tests/e2e/app.spec.ts:6`
- **Pattern:** `test.skip(`
- **Justification:** Intentional browser-smoke gate — runs exclusively in the `browser-smoke` Playwright project where IPC is mocked.
- **Status:** Acceptable. The only `test.skip` in the suite.

## Patterns confirmed absent

| Pattern | Count |
|---|---|
| `@ts-nocheck` / `@ts-ignore` | 0 |
| `test.skip` (outside app.spec.ts) | 0 |
| CJS `require()` in ESM | 0 |
| Empty `catch` blocks | 0 |
| `page.route` / route interception | 0 |
| IPC mocks outside app.spec.ts | 0 |
| tikzjax (positive assertion) | 0 |
| Express references | 0 |
| Duplicated local helpers | 0 |
