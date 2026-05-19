# Feature: Refresh Button for Forceful Re-Render

## Problem

The preview updates automatically on each buffer change from nvim.
But there are situations where a manual re-render is needed:
- The pandoc process crashed or timed out and the preview is stale
- A custom filter changed on disk and should be re-applied
- The user switched branches / stashed changes and the file on disk changed
  independently of nvim
- The preview shows a rendering error that the user wants to retry
- The user wants to compare current output with a fresh render

## Can This Already Be Done?

No single UI action for this.
The user could:
- Trigger a buffer change in nvim (type and delete a character) to force a re-render
- Close and re-open the preview
- Run pandoc manually on the command line

None of these are convenient.
A refresh button is standard in every preview tool (browser refresh, VS Code markdown
preview refresh, etc.).

## Proposed Solution

Add a Refresh button in the GUI header bar, next to the dropdown menus.

### Behavior

- Click: sends a `refresh-preview` message to the server
- Server re-renders the *last received buffer content* using the current pandoc command
  and broadcasts the new HTML
- If no buffer content has been received (no file open), the button does nothing or
  shows "No file open" on hover
- During re-render, show an animated icon or "Refreshing..." text

### Keyboard Shortcut

- `Ctrl+R` or `F5` bound to the same action
- Must not conflict with browser refresh (Ctrl+R / F5 are browser shortcuts)
  - On Linux, Ctrl+R is typically intercepted by the browser for "Reload page"
  - Alternative: `Ctrl+Shift+R` or `Ctrl+Alt+R`
  - See `keyboard-shortcut-shielding.md` for discussion of browser shortcut conflicts in
    xterm.js

### Icon

Standard refresh / reload icon:
- Circular arrow (↻ or ⟳)
- UTF-8 character: `\u21BB` or `\u27F3`
- SVG icon for cleaner rendering
- Animated spin during active refresh

### Implementation

Server-side:
```typescript
// Handle refresh request
ws.on('message', (msg) => {
  if (msg.type === 'refresh-preview') {
    renderAndBroadcast(lastBufferContent);
  }
});
```

Client-side:
```typescript
// Refresh button click handler
refreshButton.onclick = () => {
  refreshButton.classList.add('spinning');
  ws.send({ type: 'refresh-preview' });
};

// When new preview arrives, stop spinning
ws.on('preview-update', () => {
  refreshButton.classList.remove('spinning');
});
```

### UI Placement

In the header bar, grouped with other action controls:

```
[Refresh ↻]  |  File  Settings  Plugin
```

Or as part of a toolbar section with the render time indicator.

## Human Decisions Needed

1. **Keyboard shortcut**: `Ctrl+Shift+R` (cross-browser safe) vs.
   `Ctrl+R` (same as browser refresh -- intercepted).
   Decide after testing what reaches the app vs.
   the browser.
2. **Button always visible vs.
   conditionally hidden**: Always visible is simpler.
   Hide only if no file is open.
3. **Animation**: CSS spin animation vs.
   static icon that changes appearance.
   CSS spin is ~5 lines and feels responsive.

## Future Possibilities

- Long-press / right-click to open a "Refresh with debug info" option that shows the
  pandoc command and its output
- Auto-refresh on window focus (useful after switching branches)
- Refresh indicator in the status bar (replacing the button)
