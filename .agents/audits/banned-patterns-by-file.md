# Banned Patterns — Per-File Ledger

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-04
**Purpose:** Gate 2 — every `as any` / `test.skip` instance with exact file:line target.

Typed wrappers in `editor-helpers.ts` (`parseToml`, `getPandocFilters`) eliminate
`as any` from spec files. The single remaining instance is an upstream type defect.

## Active instances

### `src/tests/e2e/fixtures.ts:268`
- **Pattern:** `export const expect = base.expect as any;`
- **Justification:** `@srsholmes/tauri-playwright` v0.2.2 does not export the `PageLike` interface used in its `Expect<>` matchers (`toHaveURL`, `toHaveTitle`). Re-exporting `base.expect` triggers TS4023. The runtime value is correct; `as any` widens to avoid the declaration-emit blocker.
- **Status:** Documented. Upstream package defect.

### `src/tests/e2e/command-parsing.spec.ts:46`
- **Pattern:** `(assets as any).filters`
- **Justification:** Tauri IPC `pandoc_assets` response is untyped JSON. Narrow cast to access known `.filters` array.
- **Status:** Library type gap.

### `src/tests/e2e/command-parsing.spec.ts:98,245,292`
- **Pattern:** `load(tomlContent) as any`
- **Justification:** `js-toml` library `load()` returns `unknown`. Narrow cast to access TOML properties.
- **Status:** Library type gap.

### `src/tests/e2e/config-loading.spec.ts:137`
- **Pattern:** `load(savedContent) as any`
- **Justification:** Same library gap — `js-toml` `load()` returns `unknown`.
- **Status:** Library type gap.

### `src/tests/e2e/settings.spec.ts:92,207`
- **Pattern:** `load(savedTomlContent) as any`
- **Justification:** Same library gap — `js-toml` `load()` returns `unknown`.
- **Status:** Library type gap.

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
