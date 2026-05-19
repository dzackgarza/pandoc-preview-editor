# Feature Evaluation Framework

Every proposed feature for pandoc-preview must pass through this framework before being
added to a card.

## The Five Questions

### 1. What is the user outcome?

Define the feature by the outcome the user needs, not by the widget that delivers it.
The outcome frames everything else.

**Wrong**: "Display a warning indicator in the GUI when the buffer content differs from
the on-disk file."

**Right**: "The user knows when the buffer != disk."

### 2. Can nvim natively produce this outcome?

If nvim already handles the outcome, the real feature is **researching the nvim
solution, documenting options, and flagging for human decision** — the card should NOT
unilaterally decide to skip.

Check:
- Does a nvim plugin expose this?
  (vim-airline, lightline, etc.)
- Does a nvim built-in provide this?
  (`:ls`, `b:changedtick`, statusline)
- Does a terminal sequence communicate this?
  (OSC sequences, statusline escapes, etc.)

If yes: **Research the options, present them in the card, and flag for human decision.**
Do not conclude "skip" unilaterally.
The human decides between (a) relying on the nvim solution, (b) surfacing through the
TCP protocol, or (c) implementing independently.

### 3. Does this need to be in the glued GUI?

"Glued GUI" = the Electron/Chrome window that displays pandoc output and connects to
nvim via the TCP plugin.

Features belong in the GUI only if they:
- Display server-side state that nvim cannot access (pandoc errors, render time, plugin
  output)
- Provide a UI affordance for a server operation (refresh, export)
- Configure server behavior (pandoc command, template path)
- Orchestrate actions across both nvim and server (workspace operations)

If the feature operates entirely within nvim's domain (saving, buffer status, file
tree): **Research and document the nvim options, flag for human decision.**

### 4. How does it flow through the existing protocol?

Features must extend the existing nvim plugin TCP protocol wherever possible.
Do not build parallel systems:

- **No**: Polling `fs.stat()` on disk every 2 seconds
- **No**: Separate HTTP endpoint for data that the nvim plugin has
- **Yes**: Send `{ type: 'modified', value: true }` in the existing WebSocket message
  alongside buffer content

If the data already exists on the nvim side, extend the plugin to send it.
Do not create a second data pipeline.

### 5. Has this been researched?

Before writing any "Can This Already Be Done?"
section:

1. Search for nvim plugins that address the outcome
2. Verify claims (star counts, features, availability) using `gh repo view`
3. Cite the actual evidence, not a guess
4. If the plugin ecosystem handles it, state that clearly

## Decision Tree

```
User outcome defined
        │
        ▼
Can nvim natively do this?
   YES ──► Research nvim options, document in card, flag for human decision.
   NO ──► Does this need to be in the glued GUI?
                │
                ▼
             YES ──► Can it flow through existing protocol?
                          │
                          ▼
                       YES ──► Implement as protocol extension.
                       NO ──► Flag for human decision: worth a new system?
                               (almost always no for MVP)
             NO ──► Flag for human decision: wrong layer? or pipedream?
```

## Examples

| Feature | User Outcome | nvim Does It? | GUI Needed? | Verdict |
| --- | --- | --- | --- | --- |
| Buffer ≠ disk warning | User knows buffer != disk | YES (airline `[+]`, `b:changedtick`) | — | Research → human decision |
| Last saved timestamp | User knows when file last saved | YES (statusline, `:w` message) | — | Research → human decision |
| File tree | User navigates files | YES (nvim-tree, telescope) | — | Research → human decision |
| Compilation time | User knows how long render took | NO (server has this data) | YES | Build in GUI |
| Pandoc command config | User sets pandoc flags | NO (server uses this) | YES | Build in GUI |
