# Feature: Browser Keyboard Shortcut Shielding for xterm.js

## Problem

nvim uses Ctrl+W, Ctrl+P, Ctrl+S, Ctrl+F, and other Ctrl+letter combinations as editor
commands. The browser intercepts many of these before they reach the xterm.js
`<textarea>`, triggering browser actions (close tab, print, save dialog, find-in-page)
instead of sending the corresponding control character to node-pty.

Current `TerminalPane.ts` only calls `terminal.onData()`, which receives whatever
survives the browser's default handling.
No explicit shielding exists.

## Goal

Intercept all keystrokes the browser allows JavaScript to capture, and prevent the
browser's default action so the terminal (nvim) receives the key.
For keys the browser fundamentally cannot be stopped from capturing (Ctrl+W, Ctrl+N,
Ctrl+T in a tab), document the limitation and/or provide the standalone-window
workaround.

## Approach

Add an `attachCustomKeyEventHandler` callback in `TerminalPane.ts` that returns `false`
for controlled keys (preventing xterm.js from processing them as normal input), paired
with `event.preventDefault()` to stop the browser default action.
The handler runs before xterm.js's own key processing, acting as a gate.

## Key Categories

| Category | Examples | Behavior | Interceptable? |
| --- | --- | --- | --- |
| Unmodified printable | `a`, `1`, `[` | Pass through to terminal. Let xterm.js handle via `keydown`→`input`. | N/A |
| Ctrl+letter (terminal) | Ctrl+P, Ctrl+S, Ctrl+F, Ctrl+W | Shield from browser, send control char to PTY. | Yes, with `preventDefault()` |
| Ctrl+letter (tab chrome) | Ctrl+W, Ctrl+N, Ctrl+T | Cannot be intercepted in a browser tab. Document the standalone-window requirement. | No in tab |
| Ctrl+Shift+letter | Ctrl+Shift+C, Ctrl+Shift+V | Conventionally copy/paste in terminals. Let browser handle, or implement clipboard integration. | Yes |
| Ctrl+C (interrupt) | Ctrl+C | nvim uses for interrupt. Must reach PTY unless there's a text selection (then copy). | Yes |
| Alt+letter | Alt+key combos | Varies by OS. On macOS Option key is AltGr. xterm.js `_isThirdLevelShift` logic applies. | Depends |
| IME/Composition | CJK, dead keys, emoji picker | Must be handled by the `input` event, not `keydown`. Do not interfere. | N/A |

## Implementation Plan

### Step 1: Add `attachCustomKeyEventHandler` in TerminalPane.ts

Insert before `terminal.onData()`:

```typescript
terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
  // Only intercept keydown, not keyup/keypress
  if (event.type !== 'keydown') return true;

  const ctrl = event.ctrlKey;
  const shift = event.shiftKey;
  const alt = event.altKey;
  const meta = event.metaKey;
  const key = event.key;

  // Pass through modified keys that aren't ctrl
  if (!ctrl && !meta) return true;

  // --- Browser shortcuts to shield ---

  // Ctrl+P (print dialog) → send to nvim as Ctrl+P
  if (ctrl && !shift && key === 'p') {
    event.preventDefault();
    return false;  // Prevent xterm from processing this event as well
  }

  // Ctrl+S (save page) → send to nvim as Ctrl+S
  if (ctrl && !shift && key === 's') {
    event.preventDefault();
    return false;
  }

  // Ctrl+F (find in page) → send to nvim as Ctrl+F
  if (ctrl && !shift && key === 'f') {
    event.preventDefault();
    return false;
  }

  // Ctrl+D (bookmark) → send to nvim as Ctrl+D
  if (ctrl && !shift && key === 'd') {
    event.preventDefault();
    return false;
  }

  // Ctrl+U (view source) → send to nvim as Ctrl+U
  if (ctrl && !shift && key === 'u') {
    event.preventDefault();
    return false;
  }

  // --- Clipboard handling ---

  // Ctrl+Shift+C → copy selection
  if (ctrl && shift && key === 'C') {
    event.preventDefault();
    const selection = terminal.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection).catch(() => {});
    }
    return false;
  }

  // Ctrl+Shift+V → paste from clipboard
  if (ctrl && shift && key === 'V') {
    event.preventDefault();
    navigator.clipboard.readText().then(text => {
      terminal.paste(text);  // Use terminal.paste() which handles encoding
    }).catch(() => {});
    return false;
  }

  // --- Ctrl+C: context-dependent ---

  // Ctrl+C: if selection exists, copy; otherwise send interrupt to terminal
  if (ctrl && !shift && key === 'c') {
    const selection = terminal.getSelection();
    if (selection) {
      // There's a selection, treat as copy instead of interrupt
      event.preventDefault();
      navigator.clipboard.writeText(selection).catch(() => {});
      terminal.clearSelection();
      return false;  // Don't send ^C to the PTY
    }
    // No selection: let ^C through as interrupt (return true)
    return true;
  }

  return true;
});
```

Blocking keys that differ from xterm.js's default behavior requires ensuring xterm.js
doesn't double-emit the character.
Returning `false` from `attachCustomKeyEventHandler` tells xterm.js to completely skip
this key — no `onData` event will fire for it.
The character will be consumed entirely.
For keys where we *want* the terminal to receive them (e.g., Ctrl+P, Ctrl+S), we must
NOT return false, just call `preventDefault()` and let xterm.js's normal processing
handle it.

Wait — actually, this is the wrong approach for the "shield" case.
Let me reconsider.

### The correct pattern

`attachCustomKeyEventHandler` returns a boolean:
- `true` → let xterm.js process the key normally
- `false` → xterm.js ignores the key entirely

For keys we want to **re-route** (not block), we need:

1. Call `event.preventDefault()` to stop the browser action
2. Return `true` so xterm.js still processes the key and sends it via `onData`

For keys we want to **handle ourselves** (clipboard copy/paste):
1. Call `event.preventDefault()` to stop the browser action
2. Perform our own action (clipboard API)
3. Return `false` to prevent xterm.js from also sending the character

So the corrected mapping:

```typescript
// Ctrl+P: shield from browser, but still send to terminal
if (ctrl && !shift && key === 'p') {
  event.preventDefault();
  return true;  // Let xterm.js still process it → onData fires
}
```

```typescript
// Ctrl+Shift+C: handle clipboard, don't send to terminal
if (ctrl && shift && key === 'C') {
  event.preventDefault();
  navigator.clipboard.writeText(terminal.getSelection() || '');
  return false;  // Don't let xterm.js process this
}
```

### Step 2: Handle the non-interceptable keys

Keys like Ctrl+W, Ctrl+N, Ctrl+T cannot be intercepted in a browser tab.
Document two approaches:

**Option A: Standalone window mode** Detect if running in a standalone window
(`window.matchMedia('(display-mode: standalone)').matches`) and only shield those keys
when possible. Add a note in the docs that running as a PWA/standalone window unlocks
these keys.

**Option B: Check before launching** Add an `isStandalone` check and show a warning
banner if the user launches in a tab and expects Ctrl+W to work.

### Step 3: Add Accessibility Consideration

Add a comment noting that `screenReaderMode` interacts with this — when enabled,
xterm.js currently does not call `preventDefault` on keypress events (to allow screen
readers to see the input).
The `attachCustomKeyEventHandler` runs before this logic, so it won't break
accessibility, but needs verification.

## Files Changed

| File | Change |
| --- | --- |
| `web/TerminalPane.ts` | Add `attachCustomKeyEventHandler` callback with shielding logic |
| `web/index.html` | Optional: add `<meta name="manifest"` for PWA standalone mode |

## Testing / Validation

### Manual tests in browser tab:

1. Focus terminal, press Ctrl+P — browser print dialog should NOT appear, nvim should
   receive ^P
2. Press Ctrl+S — browser save dialog should NOT appear
3. Press Ctrl+F — browser find bar should NOT appear
4. Press Ctrl+Shift+C — should copy terminal selection to clipboard
5. Press Ctrl+Shift+V — should paste from clipboard into terminal
6. Press Ctrl+C with selection — should copy, not send ^C
7. Press Ctrl+C without selection — should send ^C interrupt to nvim

### In standalone window / PWA:

8. Ctrl+W should send ^W to nvim instead of closing the window

## Risks & Tradeoffs

- **IME interference**: `attachCustomKeyEventHandler` fires on `keydown` before IME
  composition starts. Must ensure we don't block IME-related keys.
  The `event.type === 'keydown'` guard and avoiding interference with `input` events
  should handle this.
- **Keyboard layout dependence**: `.key` returns the character for the user's layout,
  while `.code` returns the physical key.
  Using `.key` is correct for Ctrl+letter combinations (they map to the character the
  user sees), but AltGr combinations on international keyboards produce unexpected
  `.key` values.
- **macOS Cmd key**: On macOS, Ctrl+letter is rare; most shortcuts use Cmd.
  nvim's Ctrl+letter chords still work but may conflict less with browser defaults.
  Cmd+C/V/W still need consideration.
- **xterm.js version dependency**: `attachCustomKeyEventHandler` is available since
  xterm.js 4.x. Current dependency is ^5.5.0 — fine.

## Open Questions

1. Should Ctrl+C selection-copy use a timeout (clear selection after N ms)?
2. Should we expose a configuration mechanism (which keys to shield)?
3. Should `fitAddon.fit()` be called after paste to re-layout?
4. Do we want a visual indicator when a keystroke is blocked vs passed?
