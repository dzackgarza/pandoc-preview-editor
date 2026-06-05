# decisions/safe-filesystem-interaction

---
status: accepted
date: 2026-06-05
---

# Safe Filesystem Interaction

## User Outcome
The user can explore and interact with their workspace without risk of corrupting files, opening large binaries in the editor, or generating invalid filenames for assets.

## Abstract Requirements
- **Text/Binary Discrimination**: The app must reliably distinguish between text-like files (safe for editing) and binary files (unsafe). This is a safety boundary for the Explorer and Editor.
- **Path Sanitization**: Generated filenames (e.g., from clipboard pastes) must be filesystem-safe across Linux, macOS, and Windows. Sanitization must handle reserved characters, double dots, and OS-reserved names.
- **Dependency Delegation**: Logic for file-type detection and path sanitization is a solved problem in the Rust ecosystem. The app must delegate these tasks to mature, performance-tested libraries rather than maintaining bespoke implementations.

## Stability Basis
Standard libraries like `infer`, `content_inspector`, and `path-sanitize` provide deterministic, cross-platform behavior that covers edge cases (non-ASCII, reserved names) far more reliably than manual filtering.
