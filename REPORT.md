# Slop Audit Findings

Based on an audit of the codebase against the `AGENTS.md` guidelines, I have found several areas that violate the rules, specifically regarding renderer-specific arguments.

## Violations

1.  **UI Controls for Renderer Arguments (`src/client/components/SettingsDialog.tsx`)**
    *   The settings dialog contains explicit UI controls (checkboxes, selects, inputs) for Pandoc-specific flags such as `standalone`, `citeproc`, `toc`, `number-sections`, `embed-resources`, `mathjax`/`katex`/`webtex`, `template`, and `lua-filter`.
    *   **Rule Violated:** *"Do not add app-owned request fields, UI controls, or CLI parsing for renderer-specific arguments such as Pandoc templates, filters, formats, PDF engines, bibliography flags, or math flags. Put those in config or wrapper commands."* and *"Do not build a Settings UI that edits renderer arguments unless the product decision is explicitly changed. A read-only renderer display can be considered separately."*

2.  **CLI Parsing for Renderer Arguments (`src/shared/command-parser.ts` & `src/server/command-parser.ts`)**
    *   The `parseCommand` and `buildCommand` functions actively parse and serialize the render command string into discrete flags (`standalone`, `citeproc`, `math`, `selectedTemplate`, `selectedFilters`, etc.) so the UI can manipulate them.
    *   **Rule Violated:** *"Do not add app-owned request fields, UI controls, or CLI parsing for renderer-specific arguments..."*

## Recommendation

To align with the `AGENTS.md` philosophy, the application should treat the `render_command` as an opaque string.

1.  **Remove UI Controls:** Remove the specific toggles and dropdowns for arguments like templates and filters from the Settings dialog.
2.  **Remove Parser Logic:** Remove `parseCommand` and `buildCommand` from `command-parser.ts`. The app only needs to be able to safely tokenize the string if necessary, but it shouldn't try to understand the Pandoc arguments.
3.  **Replace with Raw Input:** The Settings dialog should only provide a plain text area (or a read-only display, if preferred) to view/edit the raw `renderCommand` string directly.
