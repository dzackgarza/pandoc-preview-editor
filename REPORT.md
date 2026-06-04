# Slop Audit Findings

Based on an audit of the codebase against the `AGENTS.md` guidelines, I have found several areas that violate the rules, specifically regarding renderer-specific arguments.

## Violations

1.  **UI Controls for Renderer Arguments (`src/client/components/SettingsDialog.tsx`)**
    *   The settings dialog contains explicit UI controls (checkboxes, selects, inputs) for Pandoc-specific flags such as `standalone`, `citeproc`, `toc`, `number-sections`, `embed-resources`, `mathjax`/`katex`/`webtex`, `template`, and `lua-filter`.
    *   **Rule Violated:** *"Do not add app-owned request fields, UI controls, or CLI parsing for renderer-specific arguments such as Pandoc templates, filters, formats, PDF engines, bibliography flags, or math flags. Put those in config or wrapper commands."* and *"Do not build a Settings UI that edits renderer arguments unless the product decision is explicitly changed. A read-only renderer display can be considered separately."*

2.  **CLI Parsing for Renderer Arguments (`src/shared/command-parser.ts` & `src/server/command-parser.ts`)**
    *   The `parseCommand` and `buildCommand` functions actively parse and serialize the render command string into discrete flags (`standalone`, `citeproc`, `math`, `selectedTemplate`, `selectedFilters`, etc.) so the UI can manipulate them.
    *   **Rule Violated:** *"Do not add app-owned request fields, UI controls, or CLI parsing for renderer-specific arguments..."*

3.  **File Identity for 'New' Documents (`src/server/index.ts` & `src/client/App.tsx`)**
    *   The `POST /api/files/new` endpoint updates the server's internal file state (`config.file = targetPath`, `config.isTempFile = false`) and returns success, but *does not create the file on disk until the user later triggers a save*. This means the app is tracking a "real" file path that doesn't actually exist on the file system.
    *   **Rule Violated:** *"Do not create a real user file for `New` until the user saves content to the chosen path. `New` may record a pending target, but the first save must create the file with the current textarea content."* The current code immediately treats the pending target as the canonical `config.file` (and therefore not a temporary file), creating a phantom file state on the server.

4.  **Copying Template/Filter Paths (`src/server/index.ts` & `src/client/components/SettingsDialog.tsx`)**
    *   The `SettingsDialog` has explicit inputs for `templatesDir` and `filtersDir`.
    *   The server-side code handles fetching templates from these directories via the `/api/pandoc/assets` endpoint and passes them to the client to populate dropdown menus.
    *   **Rule Violated:** *"Do not copy project-local template/filter paths into the app. Keep Pandoc-specific assets centralized under `~/.pandoc`."* The app builds infrastructure to configure and browse these directories natively, rather than just relying on the user configuring the `renderCommand` properly.

5.  **Diagram Feature File Dependency (`src/server/index.ts` line ~1032)**
    *   The diagram feature `/api/diagram/file` explicitly checks if the server is tracking a temporary file (`config.isTempFile`) and rejects creating diagram dependencies if true. This is technically compliant with "Nontrivial actions that need durable context must pass through the save gate first", however, the overall flow still attempts to do app-specific filesystem template generation (`writeFileSync(figurePath, template, 'utf-8')`).
    *   **Rule Violated:** *"Do not hand-roll framework behavior without a documented reason."* (Creating a diagram starter template isn't necessarily a bad feature, but it blurs the line of plain text editor).

## Test Findings

1.  **Mocking and Trivial Logic Tests (`src/tests/command-parsing.spec.ts`)**
    *   Many tests in `src/tests/command-parsing.spec.ts` test internal validation logic (e.g., rejecting a path outside a directory) and basic AST manipulations. While these ensure the UI logic works, the UI logic itself shouldn't exist.
    *   **Rule Violated:** *"Do not keep tests that only prove internal consistency, such as `ok` flags, non-null values, or weak substring checks. Assert exact observable outcomes."* and *"The server is mostly glue. Test it only for renderer parity/non-mangling or concrete app-owned filesystem/plugin boundaries. Do not build isolated server tests for trivial request/response plumbing."*

---

I have documented the issues. The primary action needed to address this slop is to completely replace the Settings dialog's argument parsing UI with a simple `<textarea>` bound directly to `renderCommand`, and to remove `templatesDir` and `filtersDir` as explicitly configurable, app-managed settings if they are only meant to be part of the opaque Pandoc command.
