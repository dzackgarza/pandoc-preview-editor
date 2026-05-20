# Feature: Refresh Button for Forceful Re-Render

## Status

Candidate enhancement.

## Problem

The preview updates automatically after textarea changes. A manual re-render is still
useful when external render inputs change, such as filters, templates, bibliography
files, branch checkouts, or command configuration.

## Ownership

This is app/client and app/server behavior. Refresh should re-render the current
textarea content through the configured Pandoc pipeline. It should not depend on nvim or
Firenvim state.

## Proposed Behavior

- Add a Refresh icon button near render status or the menu bar.
- On click, render the current textarea value immediately.
- Keep the current file path unchanged.
- Show render progress through the existing render status and duration display.
- Preserve the previous preview until the new render succeeds or returns an error
  document.

## Keyboard Shortcut

Use a shortcut only after testing browser behavior. `Ctrl+R` and `F5` normally reload the
page, so a menu/button-first implementation is safer than depending on a shortcut.

## Future Possibilities

- Refresh on window focus after external file changes.
- Refresh with diagnostics showing the Pandoc command, stderr, and duration.
- Refresh all external dependencies after a branch switch.
