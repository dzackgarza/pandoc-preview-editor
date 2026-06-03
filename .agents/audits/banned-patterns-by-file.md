# Banned Patterns — Per-File Ledger

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-03
**Purpose:** Gate 2 — every banned pattern instance with exact file:line target.

## Active instances

### `src/tests/e2e/fixtures.ts:268`
- **Pattern:** `as any`
- **Justification:** `@srsholmes/tauri-playwright` v0.2.2 does not export the `PageLike` interface used in its `Expect<>` matchers (`toHaveURL`, `toHaveTitle`). Re-exporting `base.expect` triggers TS4023. The runtime value is correct; `as any` widens to avoid the declaration-emit blocker. Upstream package defect.
- **Status:** Documented in source. Acceptable with justification.

### `src/tests/e2e/app.spec.ts:6`
- **Pattern:** `test.skip`
- **Justification:** Intentional browser-smoke gate — this spec runs exclusively in the `browser-smoke` Playwright project where IPC is mocked. Not a bypass; the test is designed for that project only.
- **Status:** Acceptable. The only `test.skip` in the suite.

### `src/tests/e2e/command-parsing.spec.ts:46`
- **Pattern:** `(assets as any).filters`
- **Justification:** `pandoc_assets` IPC response type from Tauri is untyped (`Record<string, unknown>`). The `.filters` field is known to be `string[]` at runtime. Narrow cast to access.
- **Status:** Narrow cast. Replace with a typed response interface from shared types when available.

### `src/tests/e2e/command-parsing.spec.ts:98`
- **Pattern:** `load(tomlContent) as any`
- **Justification:** `js-toml` library `load()` returns `unknown`. The TOML structure is validated by assertions immediately after.
- **Status:** Narrow cast. Third-party library type gap.

### `src/tests/e2e/command-parsing.spec.ts:245`
- **Pattern:** `load(savedTomlContent) as any`
- **Justification:** Same as line 98 — `js-toml` return type.
- **Status:** Narrow cast.

### `src/tests/e2e/command-parsing.spec.ts:292`
- **Pattern:** `load(savedTomlContent) as any`
- **Justification:** Same as line 98.
- **Status:** Narrow cast.

### `src/tests/e2e/config-loading.spec.ts:137`
- **Pattern:** `load(savedContent) as any`
- **Justification:** `js-toml` library `load()` returns `unknown`.
- **Status:** Narrow cast.

### `src/tests/e2e/settings.spec.ts:92`
- **Pattern:** `load(savedTomlContent) as any`
- **Justification:** `js-toml` library `load()` returns `unknown`.
- **Status:** Narrow cast.

### `src/tests/e2e/settings.spec.ts:207`
- **Pattern:** `load(savedTomlContent) as any`
- **Justification:** Same as line 92.
- **Status:** Narrow cast.

---

## Patterns confirmed absent

| Pattern | Count | Verification |
|---|---|---|
| `@ts-nocheck` | 0 | `rg '@ts-nocheck' src/tests/e2e/` — zero hits |
| `test.skip` (outside app.spec.ts) | 0 | Single instance at `app.spec.ts:6`, intentional gate |
| CJS `require()` in ESM | 0 | No CJS require calls found |
| Empty `catch` blocks | 0 | No empty-catch patterns found |
| `page.route` / route interception | 0 | No Playwright route mocking outside browser-smoke |
| IPC mocks outside app.spec.ts | 0 | `__TAURI_INTERNALS__` in `editor-helpers.ts` is the real bridge, not a mock |
| tikzjax (positive assertion) | 0 | Only negative assertion in `tikz-filter.spec.ts:54` |
| Express references | 0 | No Express server references in any spec |
| Duplicated local helpers | 0 | All specs use shared `editor-helpers.ts` or inline unique helpers |
