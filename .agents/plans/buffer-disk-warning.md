# Feature: Unsaved State Indicator

## Status

Already incorporated as the app save-state indicator.

## User Outcome

The user knows when the textarea content differs from the tracked file on disk.

## Ownership

This is app/client behavior. In the Firenvim model, nvim's modified flag describes the
temporary buffer used to edit the textarea. The app still owns whether the textarea text
has been written to the selected project file.

## Current Behavior

- Editing the textarea marks the save state as unsaved.
- Save transitions through saving to saved or save error.
- The status bar displays the save state beside render status and line count.

## Keep

- Do not poll file stats for the primary dirty state.
- Treat textarea changes as the dirty source.
- Treat successful server save as the clean transition.
- Keep tests focused on actual disk writes for save correctness.

## Future Possibilities

- Detect external file changes before overwrite.
- Show last saved time after successful save.
- Add autosave only after the explicit save contract remains stable.
