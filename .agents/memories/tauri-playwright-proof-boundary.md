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

## Capability Wiring

The Playwright plugin is test-only. Keep `tauri-plugin-playwright` behind the Rust `e2e-testing` feature and keep `playwright:default` out of the base `default` capability. The base `src-tauri/tauri.conf.json` must explicitly select only the `default` capability so Tauri does not auto-enable every capability file in `src-tauri/capabilities/`.

The E2E overlay `src/tests/e2e/tauri.e2e.conf.json` selects `default` and an inline `e2e-playwright` capability object, and the fixture passes `tauriFeatures: ['e2e-testing']`. Do not create a standalone `src-tauri/capabilities/e2e-playwright.json`: Tauri validates capability files during normal builds, so a file that names `playwright:default` breaks non-E2E Cargo commands when the plugin is not compiled. If normal `cargo test --manifest-path src-tauri/Cargo.toml` reports `Permission playwright:default not found`, the base build is still seeing a test-only permission.

## Dependency Gate

The app-owned diagram tool contract is `src/shared/diagram-tools.json`, consumed by `src-tauri/src/state.rs`. Public test gating must read that JSON instead of duplicating executable names in shell. If the gate reports `xournal` while `xournalpp` is present, that is not an alternatives bug: the JSON declares separate `xournal` and `xournalpp` tools. Change the JSON contract if the app should no longer require a tool.

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
