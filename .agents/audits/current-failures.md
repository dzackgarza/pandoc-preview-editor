# Current Test Failures Ledger

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-06
**Status:** **Systemic Failure**

The E2E suite currently fails 100% of tests with a Rust panic (exit code 101) during app startup.

---

## Systemic Failure: Rust Panic (101) in `probe_tool_state`

### Observed Symptom
Every E2E test fails immediately with:
`Error: Tauri process exited with code 101`

### Causal Evidence
- **Site:** `src-tauri/src/state.rs:125` (panicked at `unwrap_or_else(|| panic!(...))`)
- **Trigger:** The test environment lacks mathematical research tools (qtikz, tikzit, inkscape, drawio, xournal, xournalpp, ipe).
- **Classification:** **Fixture/Config Defect (D)**. The test harness (`fixtures.ts`) does not provision the hard dependencies required by the app's startup logic.

### Impact
- Blocks all E2E verification.

---

## File-Level Failures

| Spec | Failure | Classification |
|---|---|---|
| `workflow-config.spec.ts` | 101 Panic | D (Fixture Defect) |
| `workflow-editing.spec.ts` | 101 Panic | D (Fixture Defect) |
| `workflow-diagnostics.spec.ts` | 101 Panic | D (Fixture Defect) |
| `workflow-extensions.spec.ts` | 101 Panic | D (Fixture Defect) |

---

## Remediation Plan

1. **Fix Environment**: Modify `fixtures.ts` to create dummy binaries for all 7 required diagram tools in a temporary directory and add it to the `PATH` of the Tauri process.
2. **Verify Integrity**: Re-run suite. The app should start successfully. Underlying test failures (if any) will then be visible and debuggable.
