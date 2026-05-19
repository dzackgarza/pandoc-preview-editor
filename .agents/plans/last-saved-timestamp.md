# Feature: Display "Last Saved: XXXs ago" in GUI

## User Outcome

"The user knows whether the on-disk file is recently saved."

## Can This Already Be Done?

**Yes — nvim handles this natively and via plugins.**

### nvim built-ins

- `:w` prints file path and line count on save — immediate terminal feedback.
- `getftime(expand("%"))` in statusline: returns file modification timestamp.
  Statusline example: `%{strftime("%c", getftime(expand("%")))}` shows last save time.
- `&modified` flag shows `[+]` when buffer has unsaved changes.
  Together with `getftime`, the user can infer "file was saved at X" and "buffer
  currently clean/dirty."

### nvim plugins

- **vim-airline**: Shows `[+]` for modified state.
  Can be extended to show `getftime` in statusline via `airline_section_x` or similar.
- **lualine.nvim**, **lightline.vim**: Same extensibility.

### Summary

The information is:
1. Available as a nvim built-in (`getftime` in statusline, `:w` output)
2. Configurable in any statusline plugin
3. Inferred from `[+]` indicator + save awareness

## Options for pandoc-preview

### Option A: Do nothing — nvim handles it

The user has `:w` output in their terminal and can configure their statusline to show
`getftime`. This is zero work and aligns with the "nvim-first" philosophy.

### Option B: Surface saved timestamp through existing TCP protocol

The nvim plugin already fires on `BufWritePost`. Extend the buffer payload to include a
`savedAt` timestamp:

```lua
-- In nvim plugin, on BufWritePost:
local saved_at = vim.loop.now()  -- or os.time() for second precision
-- include in existing WebSocket message
```

No new channels, no polling.
The client receives `savedAt` as part of the existing buffer-update flow and displays
"Last saved: Xs ago" computed from `Date.now() - savedAt`.

### Option C: Server-side file stat polling (not recommended)

Server calls `fs.statSync(path).mtimeMs` on an interval.
Simple but introduces polling overhead and can't distinguish "saved by nvim" from "saved
by another process."

## Evaluation (per FEATURE-EVALUATION-FRAMEWORK.md)

| Question | Answer |
| --- | --- |
| What is the user outcome? | "User knows whether file is recently saved" |
| Can nvim natively do this? | YES — `getftime` in statusline, `:w` output |
| Does this need to be in the GUI? | Only if GUI is the user's primary focus |
| Can it flow through existing protocol? | YES — extends buffer-update or BufWritePost message |
| Has this been researched? | YES — nvim built-ins, airline, lualine verified |

## Human Decision Required

The research shows nvim handles this completely.
The GUI timestamp would be a convenience for users who don't look at their terminal.

**Options for decision:**
1. Skip — rely on nvim.
   Zero work.
2. Extend TCP protocol to send `savedAt` on BufWritePost — ~2 lines of Lua + ~10 lines
   of TypeScript for the "Xs ago" display.
3. Poll file stat on server — not recommended.

Recommendation is (1) or (2), but this is a human call.
