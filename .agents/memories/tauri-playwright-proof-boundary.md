---
title: Tauri Playwright Proof Boundary
status: active
tags:
  - tauri
  - playwright
  - testing
  - proof-boundary
---

# Tauri Playwright Proof Boundary

## When This Applies

Use this before editing `src/tests/`, `src/tests/playwright.config.ts`, `src/tests/e2e/fixtures.ts`, `src/tests/e2e/run-tauri-dev.sh`, `vite.config.ts`, or Tauri plugin setup in this repo.

## Standard Contract

`@srsholmes/tauri-playwright` has three modes:

- `browser`: headless Chromium with mocked Tauri IPC. This may be a harness smoke check only. It is not proof of Tauri IPC, native filesystem state, renderer invocation, workspace identity, save semantics, or plugin behavior.
- `tauri`: socket bridge to the real Tauri webview through `tauri-plugin-playwright`. Product feature proofs must use this boundary.
- `cdp`: Windows-only WebView2 CDP mode. Do not design Linux proof loops around it.

For this repo, standard feature proof means one shared fixture from `createTauriTest`, project `use: { mode: 'tauri' }`, explicit dev URL and socket/window-label agreement, `workers: 1`, isolated HOME/XDG/workspace/config/state directories, real renderer commands, and exact assertions on editor text, preview content, file paths, disk contents, config TOML, renderer diagnostics, plugin artifacts, and visible UI state.

## Local Failure Pattern To Reject

Do not repair this suite by adding connection probes, smoke tests, mocked IPC, `page.route`, broad `*.spec.ts` project sweeps, dummy dependency binaries, stale-server reuse, debug print scaffolding, or timeout increases. Those preserve a green signal while weakening the proof obligation.

Hard dependencies must be real. If `pandoc`, GUI tool launchers, WebKitGTK/Xvfb, Playwright browsers, the plugin socket, or config files are missing, the suite must fail loudly. Do not create shell stubs under `.agents/tmp/bin` to satisfy startup probes.

## Verification

Before claiming the suite is oriented correctly, run:

```bash
npx playwright test --config src/tests/playwright.config.ts --list
```

The listed tests must correspond to real workflow proofs, not diagnostic probes. Then run the public gate through `just test`; if it fails on missing external tools, fix/provision the missing tool instead of weakening the test harness.

## Upstream Sources

- Tauri official testing docs: native desktop E2E is through WebDriver/`tauri-driver`; mock runtime is not native webview proof.
- `@srsholmes/tauri-playwright` README/docs: `browser` is mocked IPC, `tauri` is true E2E through the socket bridge, `cdp` is Windows-only.
- Playwright config docs: use projects and test matching to keep proof classes explicit.
