# Banned Test Patterns — Verification

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-04
**Purpose:** Gate 3 — verification that banned patterns from `docs/testing-proof-obligations.md` are absent from the active suite.

Each row maps a banned pattern class to its verification result. Rationale and full descriptions live in `docs/testing-proof-obligations.md` "Banned Test Patterns" section. Per-instance file:line detail lives in `banned-patterns-by-file.md`.

| Pattern | Status | Exception |
|---|---|---|
| `@ts-nocheck` / `@ts-ignore` | Zero | — |
| `as any` / `: any` | 8 instances (4 files) | Library type gaps: `js-toml` `load()` returns `unknown`, `pandoc_assets` IPC is untyped, `PageLike` unexported |
| `Record<string, unknown>` shape-only assertions | Zero (exact values asserted after every IPC call) | — |
| CJS `require()` in ESM | Zero | — |
| Empty `catch` blocks | Zero | — |
| `test.skip` / xfail | 1 instance (`app.spec.ts:6`) | Browser-smoke architectural gate |
| `page.route(...)` / mocked IPC | Zero (outside `app.spec.ts`) | — |
| Browser-smoke mocks as obligation coverage | Zero (none claimed) | — |
| Duplicated local helpers | Zero | — |
| Shape-only / non-null / "visible exists" assertions | Zero (exact outcomes asserted) | — |
| Timing-theater assertions | Zero (polls assert exact content) | — |
| Express / MIME / tikzjax / central-figures / route-interception | Zero active | `tikz-filter.spec.ts` has negative tikzjax assertion; `mime-types.spec.ts` is misnamed |

## Verification commands

```bash
rg '@ts-nocheck|@ts-ignore' src/tests/e2e/     # zero
rg 'test\.skip' src/tests/e2e/*.spec.ts         # app.spec.ts only
rg 'require\(' src/tests/e2e/                  # zero
rg 'catch\s*\{' src/tests/e2e/                # zero
rg 'page\.route' src/tests/e2e/                # zero
rg 'as any' src/tests/e2e/*.spec.ts             # zero (fixtures.ts only)
npx tsc --noEmit                                # zero errors
```
