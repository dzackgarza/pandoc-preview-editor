# decisions/error-and-performance-semantics

---
status: accepted
date: 2026-06-05
---

# Error and Performance Semantics

## User Outcome
The user receives clear, unambiguous feedback on the status of their operations. Failures are surfaced with full context, and performance metadata is available without polluting the operational success contract.

## Abstract Requirements
- **IPC Contract Integrity**: The IPC layer must maintain "honest labeling." A successful IPC response (`Ok`) must imply that the requested operation (e.g., a render) succeeded. Failures (e.g., non-zero exit codes) must be returned as structured errors.
- **Fail-Fast Boundary**: The app must avoid "success-shaped errors" (e.g., a 200 OK payload that contains `ok: false`). This prevents the frontend from having to "peek" into data to determine status and avoids UI state flickers.
- **Performance Metadata**: Tracking and displaying operation duration (e.g., render time) is a valid user requirement for monitoring efficiency. However, timing data is diagnostic metadata and must not be a core part of the operation's success/failure identity.
- **No Silent Defaults**: Runtime logic must never mask configuration or state errors with "safe" defaults (e.g., defaulting to the current directory when a workspace is missing). Errors must propagate to the UI to ensure the user is aware of the system's actual state.

## Stability Basis
Explicit error propagation (Rust's `Result`) and metadata separation ensure that the application remains predictable and that "Timing Theater" (brittle tests based on latency) is avoided.
