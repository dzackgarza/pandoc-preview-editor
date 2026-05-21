# Feature Card: Interactive Project Image and Figure Editing

## User Outcome

The user can quickly launch desktop-native image editors (like GIMP, Inkscape, Pinta, or Xournal) to edit any SVG, PNG, or XOJournal figure attached to the current project/workspace, without leaving the app or manually searching through the filesystem.

## Implementation Details

Rather than embedding complex GUI managers inside the browser, the application leverages lightweight host-native system commands.

### Server Interactive Spawn Route

The Express backend implements a new interactive trigger endpoint:

* **Endpoint**: `POST /api/figures/edit-interactive`
* **Workflow**:
  1. The server resolves the `./figures` directory relative to the currently active markdown file.
  2. The server scans the directory and pipes the list of figures directly into an external `dmenu -i` invocation:
     ```bash
     find ./figures -type f | sed 's#.*/##' | dmenu -i
     ```
  3. Based on the selected file's extension, the server determines the correct GUI editor (e.g., Inkscape for `.svg`, Xournal for `.xoj`, GIMP or Pinta for `.png`).
  4. The server launches the editor process completely detached in the background so it doesn't block Express:
     ```typescript
     import { spawn } from 'child_process';
     spawn(editorCommand, [selectedFilePath], { detached: true, stdio: 'ignore' }).unref();
     ```

### Client Integration

* **Toolbar Action**: Adds an "Edit Figures" option in the toolbar and under the workspace menu.
* **Action**: When clicked, the client fires a quick fetch call to `/api/figures/edit-interactive`, and the system-native `dmenu` prompt handles the selection and editor launch in the background.

## Verification Plan

### Manual Verification

* Attach figures (SVG, PNG, XOJournal) to a project.
* Click the "Edit Figures" action in the toolbar and verify that a `dmenu` window appears on screen showing the figures list.
* Select an item and assert that GIMP, Inkscape, or Xournal opens with the chosen file loaded.
