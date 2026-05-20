# Feature: File Menu With Document Actions

## Status

Already incorporated.

## Problem

The app now owns document file interaction because Firenvim only edits the textarea. A
File menu is the correct home for document actions that map textarea text to disk.

## Current Behavior

- **New** creates a real untitled markdown file in the workspace and clears the editor.
- **Open** shows the Explorer so the user can choose a workspace file.
- **Save** writes the current textarea content to the tracked file path.
- **Ctrl+S** triggers the same save path as File > Save.

## Ownership

This is app/server behavior. Nvim `:w` only saves Firenvim's temporary textarea buffer
back into the browser field; it does not choose or write the app's project file.

## Keep

- File actions stay in the app.
- Save reads the canonical textarea state.
- Server writes only inside the selected workspace/file contract.
- Tests must prove disk content, not only UI state.

## Future Possibilities

- Recent files
- Close current document
- Export submenu through the plugin command system
