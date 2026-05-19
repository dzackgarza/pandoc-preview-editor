# Feature: Warning When Buffer != On-Disk Content

## User Outcome

"The user knows when the in-memory buffer differs from the on-disk file."

## Can This Already Be Done?

**Yes — this is a solved problem in the nvim ecosystem.**

### nvim built-ins

- `&modified` (vim option): Set when buffer has unsaved changes.
  False on :w.
- `b:changedtick` (variable): Monotonically increments on each buffer change.
  nvim provides `nvim_buf_changedtick_event` for async notification.
- `:ls` shows `+` for modified buffers, `a` for active, `h` for hidden.
- `%m` statusline item shows `[+]` when modified.

### nvim plugins

- **vim-airline**: Shows `[+]` indicator on statusline/tabline for modified buffers
  (issue #544, #316). Color-coded sections change based on buffer state.
  ~16k stars.
- **lightline.vim**: Same pattern — configurable section with `'modified': 1` shows `+`.
- **lualine.nvim**: Same pattern, Lua-based.

### Summary

The information is:
1. Available as a nvim built-in (`&modified`)
2. Displayed in most statusline plugins by default
3. Visible directly in the terminal — no GUI round-trip needed

## Options for pandoc-preview

### Option A: Do nothing — nvim handles it

The user sees `[+]` in their nvim statusline.
This is the simplest, most direct solution.
Nvim already shows the same info in the primary editing interface.

### Option B: Surface modified flag through existing TCP protocol

Extend the nvim plugin's `send_buffer_update` to include a `modified` boolean (available
via `vim.bo[bufnr].modified` in Lua).

- Server receives `{ modified: true, content: "..." }`
- Client shows a dot/icon in the GUI header
- No polling, no separate system — extends existing message format
- Protocol change: trivial on the plugin side (add one field to the existing JSON
  payload)
- Evaluate: does the GUI user need this if they're looking at the terminal right
  below/beside the GUI? (tmux split, tiled WM, etc.)

### Option C: Poll file stat on server side (not recommended)

- Server periodically calls `fs.stat(file).mtime`
- Compares against last buffer-update timestamp
- No nvim plugin changes needed
- Introduces polling (latency, waste)
- Can't distinguish "saved by another process" from "saved by nvim"

## Evaluation (per FEATURE-EVALUATION-FRAMEWORK.md)

| Question | Answer |
| --- | --- |
| What is the user outcome? | "The user knows when buffer != disk" |
| Can nvim natively do this? | YES — trivially (`&modified`, airline `[+]`) |
| Does this need to be in the GUI? | Only if GUI is the user's primary focus |
| Can it flow through existing protocol? | YES — extends buffer-update message |
| Has this been researched? | YES — nvim built-ins, airline, lightline, lualine verified |

## Human Decision Required

The research shows nvim handles this completely.
The question is whether the GUI should also surface it for users who work in a layout
where the terminal statusline isn't visible (e.g., fullscreen GUI on one monitor,
terminal hidden behind splits).

**Options for decision:**
1. Skip — rely on nvim.
   Zero work.
2. Extend TCP protocol to send `modified` flag — ~2 lines of Lua + ~5 lines of
   TypeScript. Trivial effort.
3. Poll file stat on server — not recommended.

The recommendation is (1) or (2), but this is a human call.
