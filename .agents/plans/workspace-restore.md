# Feature: CLI Workspace Restore (Load Previous State)

## Problem

When the app is started without a file argument (`pandoc-preview` with no path), it has
no file to display. The user must open a file from nvim to see a preview.
If the session was interrupted (crash, reboot, server restart), the user loses their
context.

## Can This Already Be Done?

**Yes, entirely within nvim.** nvim has several session management plugins:

| Plugin | Description |
| --- | --- |
| **rmagatti/auto-session.nvim** | Auto-save and restore nvim sessions (buffers, layout, cursor position, working directory). 1.8k stars. |
| **Shatur/neovim-session-manager** | Session management with UI picker. 617 stars. |
| **folke/persistence.nvim** | Lazy.nvim style session management. 984 stars. |
| **vim-scripts/sessionman.vim** | Legacy session manager. |
| **:mksession** (built-in) | nvim's built-in session save/restore. |

These all handle saving and restoring:
- Open buffers and their file paths
- Window layout and splits
- Cursor position per buffer
- Working directory
- Option values

### Analysis: Should This Be In-App?

Arguments for in-app workspace restore:
- The app could restore not just nvim state but also preview state (scroll position,
  pandoc command config, plugin menu state)
- A single CLI command restores both the editor and the preview

Arguments against:
- nvim session plugins are mature and handle this already
- The preview server is stateless by design -- no persistent state to restore beyond
  what's in nvim
- If nvim re-opens the same buffers on restart, the TCP connection will re-send buffer
  content, triggering preview updates naturally

**Recommendation**: Document `rmagatti/auto-session.nvim` as a recommended plugin
alongside `auto-save.nvim`. The app itself does not need workspace restore -- nvim
handles it.

### MVP: Document nvim Session Plugin

Add to the README's "Recommended Plugins" section:

```lua
-- Example: rmagatti/auto-session.nvim
{
  "rmagatti/auto-session",
  config = function()
    require("auto-session").setup({
      auto_save_enabled = true,
      auto_restore_enabled = true,
    })
  end,
}
```

With this, running `pandoc-preview` on a directory (or with no args) after restarting
restores the user's previous nvim session, which connects to the preview server and
sends buffer content.

### If Building a Minimal In-App MVP

If nvim session plugins are not acceptable (user runs a minimal config):

1. Server stores in `~/.local/state/pandoc-preview/session.json`:
   ```json
   {
     "lastFile": "/home/user/project/doc.md",
     "lastFiles": ["/home/user/project/a.md", "/home/user/project/b.md"],
     "pandocCommand": "pandoc --from markdown --to html --mathjax"
   }
   ```
2. On server start with no file argument:
   - Read session file
   - If `lastFile` exists, report it to the GUI (show "Last session: doc.md")
   - Send `{ type: 'no-file', lastFile: '/path/to/doc.md' }` to client
   - GUI shows a "Restore last session" button
   - Click sends `:e /path/to/doc.md` to nvim
3. On file change / new file, update the session file

This is simple (~30 lines) but minimal -- it only restores the file path, not the full
workspace state (buffers, layout).

## Human Decisions Needed

1. **Delegate to nvim or build in-app?** Strong recommendation to delegate to nvim's
   session plugins. But the user should confirm.
2. **If building**: What data to store?
   Just the last file path (MVP), or a full list of open buffers, scroll positions,
   window layout?
3. **Session file format and location**: XDG compliant
   (`~/.local/state/pandoc-preview/`)? Simple JSON?

## Future Possibilities

- Full workspace restore (list of open buffers, scroll positions per file, preview
  scroll position)
- Session auto-save timer (every 30s write session state)
