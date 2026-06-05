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
- **Site:** `src-tauri/src/state.rs:114`
- **Logic:** `probe_tool_state` iterates over `DIAGRAM_TOOLS` and calls `.unwrap_or_else(|| panic!(...))` if any tool's executable is missing from `PATH`.
- **Trigger:** The test environment lacks mathematical research tools (qtikz, tikzit, inkscape, drawio, xournal, xournalpp, ipe).
- **Classification:** **App Defect (A)** / **Slop Remediation Required**. The "fail-fast" implementation is overly aggressive, making the app unusable unless all 7 external tools are present, even if not needed for the current document.

### Impact
- Blocks all E2E verification.
- Blocks app startup on systems missing any of the 7 diagram tools.

---

## File-Level Failures

| Spec | Failure | Classification |
|---|---|---|
| `workflow-config.spec.ts` | 101 Panic | A (App Defect) |
| `workflow-editing.spec.ts` | 101 Panic | A (App Defect) |
| `workflow-diagnostics.spec.ts` | 101 Panic | A (App Defect) |
| `workflow-extensions.spec.ts` | 101 Panic | A (App Defect) |

---

## Remediation Plan (Draft)

1. **Relax `probe_tool_state`**: Change from a startup-blocking `panic!` to a structured error state or a "Missing" tool entry. 
2. **Feature Gate**: Only fail when a specific diagram tool is *invoked* and found missing, not at app launch.
3. **Audit Results**: Re-run suite after relaxation to identify underlying test failures masked by this panic.
