# Feature: Last Saved Timestamp

## Status

Candidate enhancement.

## User Outcome

The user knows when the current tracked file was last written by the app.

## Ownership

This is app/client behavior. Nvim `:w` output is not authoritative for the browser app's
selected file because Firenvim writes back to the textarea, not directly to the app's
project file.

## Proposed Behavior

- Record `savedAt` after a successful `POST /api/save`.
- Display a compact timestamp in the status bar or save-state tooltip.
- Clear or mark stale when the current file changes.
- Keep the dirty/clean indicator separate from the timestamp.

## Non-Goals

- Polling disk modification time as the primary save signal
- Inferring save state from Firenvim or nvim statusline output
- Showing a rolling save history
