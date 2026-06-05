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

- **Local-Only Operation**: All file paths are absolute or workspace-relative host paths. The app does not implement network transport layers for files.
- **Application Configuration**: `~/.config/pandoc-preview/config.toml` (via XDG spec).
- **Pandoc Assets**: Centralized under `~/.pandoc/templates/` and `~/.pandoc/filters/`.
- **Figures**: Document-relative `./figures/` directory.

## 3. Implementation Specifics

- **Git Status Machine**: The backend must track the git state of the active file (`noRepo`, `untracked`, `trackedDirty`, `trackedClean`) using the `git` CLI or a library.
- **Save+Commit Coupling**: When `gitStatus` allows, the `save` command must execute `git add` and `git commit` as part of the atomic write sequence.
- **Renderer Execution**: Spawned via `std::process::Command` with `shell: true` (for shell expansion support).
- **Atomicity**: File writes performed via temporary sibling files and atomic renames.
- **Conflict Detection**: `mtimeMs` and content hashes used to detect external modifications.
- **Version Control**: Integration with local `git` binary for save-as-commit behavior.
