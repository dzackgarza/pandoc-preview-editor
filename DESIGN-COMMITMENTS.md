# DESIGN-COMMITMENTS.md

## 0. Authority

This document records the concrete technical commitments for the `pandoc-preview` implementation. It is normative for implementation decisions.

## 1. Technological Stack

- **Substrate**: Tauri (v2) for desktop windowing and IPC.
- **Backend**: Rust for filesystem operations, state management, and process execution.
- **Frontend**: React (with Vite) for UI orchestration.
- **Styling**: Tailwind CSS.
- **Communication**: Tauri IPC (Commands and Events).

## 2. File Conventions

- **Application Configuration**: `~/.config/pandoc-preview/config.toml` (via XDG spec).
- **Pandoc Assets**: Centralized under `~/.pandoc/templates/` and `~/.pandoc/filters/`.
- **Figures**: Document-relative `./figures/` directory.

## 3. Implementation Specifics

- **Renderer Execution**: Spawned via `std::process::Command` with `shell: true` (for shell expansion support).
- **Atomicity**: File writes performed via temporary sibling files and atomic renames.
- **Conflict Detection**: `mtimeMs` and content hashes used to detect external modifications.
- **Version Control**: Integration with local `git` binary for save-as-commit behavior.
