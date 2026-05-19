# Feature: Multi-Workspace Switching

## Problem

Users working on multiple projects need to switch contexts.
Currently, this requires:
1. Closing the current nvim session and starting a new one in the other project
2. Opening a new pandoc-preview server in the other directory

A workspace switcher would let users save named workspaces (project directory, open
files, server config) and jump between them from the GUI.

## Can This Already Be Done?

**Yes.** nvim handles multi-project work naturally through:
- Multiple nvim instances (one per project, connect different preview servers to
  different instances)
- Session management plugins that can save/load named sessions
- `vim-rooter` / `project.nvim` for project-aware configuration
- `telescope` projects picker for switching between recent projects

The key question: does the preview server need to know about workspaces?
The preview server is per-project (it serves files from a root directory).
A workspace switch would mean:
1. Configuring the server to serve a different directory
2. Notifying nvim to change its working directory and open the workspace's file list
3. Updating the GUI to reflect the new project context

This is significantly more complex than the existing workflow of `:cd /other/project` in
nvim and starting a separate preview server there.

### Analysis: Should This Be In-App?

**Dependencies**:
- This feature depends on workspace restore (`workspace-restore.md`), which itself
  should likely delegate to nvim
- It also depends on the file tree (`file-tree-drawer.md`), which should likely be
  skipped in favor of nvim plugins

If both of those dependencies suggest "delegate to nvim," this feature also defaults to
"delegate to nvim."

**Recommendation**: Do NOT build workspace switching into the app.
Document the nvim-native workflow instead:

1. **Per-project servers**: Start `pandoc-preview` in each project directory
2. **Session plugins**: Use `auto-session.nvim` to save/restore project state
3. **Terminal multiplexer**: Use tmux to manage multiple terminal sessions, each running
   nvim + pandoc-preview in a different project

### Minimal In-App Workspace MVP

If overridden by human decision to build it:

1. **Workspace definition** (TOML or JSON in `~/.config/pandoc-preview/workspaces/`):
   ```json
   {
     "name": "Research Paper",
     "root": "/home/user/papers/math-2026",
     "lastFile": "/home/user/papers/math-2026/main.md",
     "pandocCommand": "pandoc --from markdown --to html --mathjax --bibliography refs.bib"
   }
   ```
2. **GUI workspace switcher**: Dropdown in the header bar listing saved workspaces
3. **Switching behavior**:
   - Send `:cd /new/project/root` to nvim
   - Send `:e /new/project/root/main.md`
   - Update server's pandoc command if the workspace specifies one
   - Update the file tree (if implemented) to show the new project
4. **Save current as workspace**: Button in workspace dropdown to save the current state
   as a named workspace

## Human Decisions Needed

1. **Build or don't build?** Strong recommendation to skip.
   nvim handles multi-project workflows natively.
   Only build if:
   - The target audience is non-nvim users who don't know `:cd`
   - The app becomes a standalone desktop app (unlikely near-term)
2. **If building**: Workspace storage format and location.
   JSON is simplest.
3. **If building**: Should workspaces be autodiscovered (scan for project markers like
   `.git`, `Cargo.toml`, `package.json`) or manually created?

## Dependencies

- `workspace-restore.md` (the session save/load mechanism)
- `file-tree-drawer.md` (the file tree would need to update on workspace switch)
- `settings-dropdown-pandoc-command.md` (workspace-specific pandoc command)

## Non-Goals

- Cloud-synced workspaces
- Workspace sharing between users
- Workspace templates or scaffolding
