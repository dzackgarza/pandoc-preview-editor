# Feature: Configurable Pandoc Command in Settings Dropdown

## Problem

The pandoc command and its arguments are currently hard-coded in the server.
Users who want to:
- Use a different pandoc binary (e.g., from a nix shell, container, or custom build)
- Add custom pandoc arguments (e.g., `--mathjax`, `--filter`, `--bibliography`)
- Change the output format
- Set environment variables for pandoc
- Use a different markdown engine entirely

have no way to configure this without editing source code.

## Can This Already Be Done?

Partially. Users could modify `server/render.ts` directly, but this is fragile and lost
on updates. Environment variables could wrap the binary path, but not all pandoc
arguments are controllable this way.

A proper config surface in the GUI is not available through existing nvim/lsp means
since the pandoc invocation runs on the *preview server*, not inside nvim.

## Proposed Solution

Add a "Settings" dropdown menu in the GUI header, next to "File" and "Plugin" menus.
The Settings menu exposes a text-based entry for the full pandoc command line, stored as
a single editable string.

### Menu Framework (Shared Across All Dropdowns)

Do not hand-roll a separate dropdown for each menu.
All dropdown menus (Settings, File, Plugin) use a **single shared menu component**.

The menu framework needs: click-to-open, nested submenus (for Plugin categories),
click-outside-to-close, keyboard navigation (arrows + Enter + Escape), and positions
itself correctly at edge of screen.

Options (to be researched before final decision):

- **Popper + thin wrapper**: [Popper](https://popper.js.org/) for positioning only, with
  a ~50-line custom wrapper for menu items/keyboard nav.
  Most flexible, smallest dependency, but more code to write.
- **Choices.js**: [GitHub - choicesjs/choices](https://github.com/choicesjs/choices) —
  ~20KB, accessible, searchable.
  No native submenu support but could be nested.
- **@floating-ui (Popper v2 successor)**: Modern Popper replacement, tree-shakeable.
  Same approach as Popper + thin wrapper but actively maintained.
- **Tether Drop**: [GitHub - HubSpot/drop](https://github.com/HubSpot/drop) — ~6KB,
  dependent on Tether.
  Simple, but no submenu support.

**Pre-requisite**: Research the maturity of each option for our use case (dropdowns with
submenus, keyboard nav, click-outside-dismiss).
This research blocks all three dropdown features (Settings, File, Plugin).

**Human decision needed**: Choose the menu framework.

### Setting: Custom Pandoc Command

A text input (single-line or textarea) where the user types the pandoc invocation:

```
pandoc --from markdown --to html --mathjax --standalone -H ~/.pandoc/templates/header.html
```

Parsing approach:
- Split on spaces respecting shell quoting (single quotes, double quotes, escapes)
- First token is the binary path (could be absolute, bare name, or use `env`)
- Remaining tokens are passed as arguments
- Preserve the ability to pass `--filter` pointing to custom filter scripts

### Storage

- Stored in `localStorage` under a key like `pandoc-preview:pandoc-command`
- Default value: the current hard-coded invocation
- On server start / page load, send the stored command to the server
- Server validates the command is runnable on first render attempt

### UI Layout

```
+-- Settings ------------------------+
| Pandoc Command:                    |
| [pandoc --from markdown --to...  ]|
|                                     |
| [Apply]                             |
+-------------------------------------+
```

- Dropdown opens from a gear icon or "Settings" label in the header bar
- Text input is the primary focus; no need for complex form controls
- "Apply" button re-renders the preview with the new command
- Server validates that pandoc runs (error shown in preview area if it fails)

## Human Decisions Needed

1. **Menu framework choice**: Popper + custom vs Choices.js vs other.
   Popper is recommended for minimal dependency overhead.
2. **Storage location**: localStorage vs server-side config file.
   localStorage is simpler for MVP but lost on cache clear.
   Server-side config persists across browser resets.
3. **Validation strategy**: Try the command on Apply and show an error, or pre-validate
   the command string format?
   Simplest: run pandoc with `--version` to verify the binary exists.

## Future Possibilities

- Preset dropdown (pandoc, multimarkdown, cmark, etc.)
- Per-project config files
- Environment variable overrides
