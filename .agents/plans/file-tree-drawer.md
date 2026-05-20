# Feature: Explorer Drawer

## Status

Already incorporated.

## Problem

Users need to choose which project file the textarea edits and saves. Firenvim can edit
the textarea, but it does not expose a project file tree or bind the textarea to a
selected file on disk.

## Current Behavior

The app provides a collapsible Explorer drawer backed by server-side workspace reads.
It lists text-like files, ignores generated/dependency directories, opens selected files
into the editor, and updates the app's current save target.

## Ownership

This is app/server behavior. Nvim file explorer plugins remain useful inside a normal
nvim session, but they cannot set the browser app's current file unless the app exposes a
filesystem surface.

## Keep

- Lazy directory expansion is enough for the current app.
- File reads and listing stay constrained to the workspace root.
- Opening a file replaces textarea content and current file identity.
- Saving after opening a file targets the opened file.

## Non-Goals

- Rename/delete/move operations
- Git status indicators
- Drag-and-drop file operations
- Replacing full nvim project navigation outside the browser app
