# Feature: "File" Dropdown Menu With Save Button

## Problem

The "Save" action currently lives as a standalone button in the GUI header.
As more features are added (Settings, Plugins, Refresh), the header becomes cluttered.
A "File" dropdown menu is the standard UI pattern for organizing document-level actions.

## Can This Already Be Done?

Saving the file is triggered by nvim's `:w` command, which already works.
The GUI's Save button is a convenience that fires `:w` via the TCP connection.
This does not add new functionality — it moves an existing control into a standard menu
structure for visual organization.

This can already be done by the user pressing `:w` in nvim.
The GUI Save button exists for discoverability (users who expect a Save button in a
GUI). Moving it to a File menu preserves discoverability while reducing header clutter.

## Proposed Solution

Replace the standalone Save button with a "File" dropdown menu containing:

### Menu Items

```
+-- File --------+
| Save     Ctrl+S |
| Close           |
+-----------------+
```

- **Save**: Existing behavior — sends save signal to nvim via TCP
- **Close**: Closes the preview tab/window (browser-level close, or custom cleanup
  sequence)

If additional file-level actions are added later (Open, Export, Print), they go here.

### Menu Framework

Same as the Settings menu (see `settings-dropdown-pandoc-command.md`). Recommendation:
Popper + thin custom wrapper, shared across all dropdown menus.

### Implementation

- Move the Save button's click handler into the File > Save menu item
- Add keyboard shortcut hint display (`Ctrl+S`) next to the menu item text
- The dropdown opens on click of the "File" label in the header bar
- Clicking outside closes the dropdown
- Keyboard navigation: arrow keys to move between items, Enter to activate

### Keyboard Shortcut

- `Ctrl+S` should trigger Save from anywhere in the GUI
- This is a separate concern from nvim's Ctrl+S handling (which may conflict with
  browser save dialog — see `keyboard-shortcut-shielding.md`)
- If Ctrl+S is intercepted by the browser, use an alternative shortcut or ensure
  pass-through to the xterm.js terminal

## Human Decisions Needed

1. **Should the File menu include Open?** Opening files is handled by nvim.
   The GUI could send `:e <path>` but this duplicates nvim's file picker.
   Recommend: exclude Open for MVP, since nvim's own file picker is superior.
2. **Should Close also send `:q` to nvim?** Closing the browser tab doesn't close nvim.
   Sending `:q` on close would be surprising.
3. **Placement in menu bar order**: File, Settings, Plugin (conventional).

## Future Possibilities

- "Export" submenu (tied to Plugin system — see `plugin-dropdown-system.md`)
- "Recent Files" submenu
- "Print" sending to browser print dialog
