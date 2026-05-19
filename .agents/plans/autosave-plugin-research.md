# Feature: Nvim Autosave Plugin Research and Recommendation

## Problem

Users of pandoc-preview may expect the file to be automatically saved at regular
intervals or on specific triggers (on idle, on focus loss, on buffer switch).
Without autosave, the user must manually run `:w` to persist changes to disk, and the
preview may not reflect the on-disk state when other tools read the file.

## Can This Already Be Done?

Yes. nvim has several mature autosave plugins.
The user outcome ("file is saved automatically") is entirely handled in the editor
layer. The GUI server does not write files; it only reads them.

The question is not *whether* autosave can be done — it's which plugin to recommend as a
dependency for users who want this behavior.

## Proposed Solution

### Research Existing Plugins

Survey the following autosave plugins for nvim:

| Plugin | Approach | Stars | Notes |
| --- | --- | --- | --- |
| **Pocco81/auto-save.nvim** | BufWritePre autocmd on InsertLeave, TextChanged, etc. | 765 | Configurable events, debounce=135ms, conditionals, callbacks. Last push May 2024. |
| **okuuva/auto-save.nvim** | Fork of above with async support | 313 | Active fork, debounce=1000ms, immediate_save/defer_save, AutoSaveWritePre/Post events |
| **folke/which-key.nvim** (no) | Not autosave | - | N/A |
| **907th/vim-auto-save** | Pre-nvim vimscript approach | 465 | Legacy, fewer features. No longer actively maintained. |

### Evaluation Criteria

1. **Debounce / idle detection**: Does it save immediately on change, or wait until
   idle? Idle-based saving is preferable for pandoc-preview because saving during rapid
   typing triggers unnecessary re-renders.
2. **Event control**: Can it be configured to save only on specific events (InsertLeave,
   FocusLost, TextChangedStop)?
3. **Performance**: Does it use async saves?
   Does it trigger LSP/formatters on save (can be slow)?
4. **Configurability**: Can users disable it per-filetype, per-buffer?
5. **Maintenance**: Is the plugin actively maintained?

### Recommendation (preliminary, pending research)

**Pocco81/auto-save.nvim** is the most popular and feature-rich.
It supports:
- Debounce / idle delay
- Event-based triggering (InsertLeave, TextChanged, FocusLost)
- Per-buffer enable/disable
- Silent saves (no status message)
- Pre-save and post-save hooks

Installation via lazy.nvim:
```lua
{
  "Pocco81/auto-save.nvim",
  config = function()
    require("auto-save").setup({
      enabled = true,
      trigger_events = { "InsertLeave", "TextChanged" },
      debounce_delay = 1000,  -- 1s debounce
      write_all_buffers = false,
    })
  end,
}
```

### Documentation

Add to the project README under a "Recommended Plugins" section:
- Plugin name and link
- Minimal configuration block
- Explanation of why autosave is useful with live preview
- Note that without autosave, `:w` must be run manually for changes to appear in tools
  that read the file

## Why Not Built-In Autosave

nvim has no built-in autosave.
The closest is `:help 'autowrite'` which saves when switching buffers or running certain
commands, but it does not save on idle, on keystroke, or on focus loss.
A plugin is required for any non-manual autosave behavior.

## Human Decisions Needed

1. **Which plugin to recommend**: Pending actual research (stars, maintenance status,
   feature comparison).
   The recommendation above is preliminary.
2. **Default configuration**: Debounce delay, trigger events, whether to save on
   InsertLeave or TextChanged or both.
   TextChanged-only is more conservative but may miss the final keystroke before idle.
3. **Whether to bundle**: The plugin is not bundled with the app.
   It's documented as an optional dependency.

## Future Possibilities

- Detect if autosave plugin is installed and show a "Live autosave" indicator
- Integration with the "Unsaved changes" indicator (buffer-disk-warning.md): if autosave
  is active, the unsaved indicator should clear automatically within the debounce period
