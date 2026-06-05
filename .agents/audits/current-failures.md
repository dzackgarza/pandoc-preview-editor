# Current Test Failures Ledger

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-06
**Status:** Environment blocker

The public gate currently stops before Rust unit tests or desktop E2E because required app startup tools are not all available on `PATH`.

## Current Public-Gate Failure

### Observed Symptom

`just test` fails in `_check-dependencies` with:

```text
FATAL: Missing hard dependencies required for pandoc-preview startup:
  - drawio (drawio or draw.io)
  - xournal (xournal)
  - ipe (ipe)
```

### Causal Evidence

- **Source of truth:** `src/shared/diagram-tools.json` declares the diagram tools and executable alternatives consumed by `src-tauri/src/state.rs`.
- **Current shell state:** `pandoc`, `qtikz`, `tikzit`, `inkscape`, and `xournalpp` resolve on `PATH`; `xournal`, `ipe`, and `drawio`/`draw.io` do not.
- **Classification:** Environment provisioning blocker. This is not a fixture defect.

### Impact

- Blocks Rust startup-dependent tests and Tauri desktop workflow proofs.
- The gate now fails before E2E launch instead of laundering missing tools through dummy executables.

## Remediation

- Install or expose the real `xournal`, `ipe`, and `drawio`/`draw.io` executables on `PATH`, then rerun `just test`.
- If any listed tool is no longer intended to be a hard app dependency, change `src/shared/diagram-tools.json` and the app-owned behavior it drives. Do not weaken the test harness or create shell stubs.
