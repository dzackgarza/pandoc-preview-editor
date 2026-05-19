# Feature: Collapsible File Tree Drawer

## Problem

Users need to navigate between markdown files in their project.
The current workflow requires switching to the nvim terminal, using nvim's file explorer
(`:Explore`, `netrw`, `nvim-tree`, `telescope`), and then typing in the GUI to get a
preview. A file tree in the GUI would let users:
- See project structure at a glance
- Click a file to open it in nvim (without leaving the preview)
- Understand which file is currently being previewed in context of the project

## Can This Already Be Done?

**Yes, extensively.** nvim has a rich ecosystem of file explorer plugins:

| Plugin | Description |
| --- | --- |
| **nvim-tree/nvim-tree.lua** | File tree sidebar in nvim itself. 8.4k stars. |
| **preservim/nerdtree** | Classic vim file tree. ~20k stars. |
| **nvim-neo-tree/neo-tree.nvim** | Modern file tree with git status, diagnostics. |
| **stevearc/oil.nvim** | File explorer as a buffer (not a tree, but fast). |
| **telescope.nvim** | Fuzzy finder (files, grep, buffers, git). |
| **vim-rooter** | Auto-cd to project root. |

These all work inside nvim and are far more capable than anything we could build in the
GUI (rename, delete, git status, file operations, etc.).

**Alternative**: nvim already has a `Telescope find_files` mapping (`Ctrl+P` in many
configs) that is faster than any GUI file tree for file navigation.

### Analysis: Should This Be In-App?

Arguments for in-GUI file tree:
- Users who don't know nvim keybindings can navigate files with mouse clicks
- The file tree shows the project root that pandoc-preview is serving
- Could show file status (modified, saved, unsaved) from the server's perspective

Arguments against:
- Duplicates nvim's far more capable file navigation
- Adds significant UI complexity (file watching, tree state, scroll sync)
- The existing nvim terminal already supports file operations
- Users who want a file tree in the GUI already have one in nvim

**Recommendation**: Do NOT build an in-GUI file tree.
Instead, ensure the nvim terminal integration is good enough that users stay in nvim for
file navigation. If users want a mouse-clickable file tree, they can use `nvim-tree`
inside nvim.

### If Building Anyway (Desktop App Context)

If the decision is to build it despite the above:

**UI**:
- Left sidebar drawer, collapsible (toggle with hamburger icon or `Ctrl+B`)
- Shows directory tree based on the project root (or `:pwd` from nvim)
- Click a file: sends `:e /path/to/file` to nvim via TCP
- Highlights the currently open file
- Polls filesystem for changes (new/deleted files) every 5s

**Implementation**:
- Ignore `node_modules/`, `.git/`, `target/`, `dist/`, etc.
- Use `fs.readdirSync` recursively (or lazily expand directories)
- Server sends the tree structure as JSON to the client
- Client renders a nested list with expand/collapse

## Human Decisions Needed

1. **Build or don't build?** Strong recommendation to skip this in favor of existing
   nvim plugins. Human decision required because the answer depends on the target
   audience (terminal-centric users vs.
   GUI-centric users).
2. **If building**: Where does the file tree get its root path?
   From nvim's `:pwd`, or from a configured project root?
3. **If building**: Lazy loading (expand directories on click) vs.
   full tree on load. Lazy is better for large projects.

## Non-Goals (If Building)

- File operations (rename, delete, create) -- stay in nvim
- Git status indicators -- nvim-tree/telescope handle this
- Drag-and-drop file reordering
- Multi-select or batch operations
