# pandoc-preview Agent Rules

Read this file before editing this repository. Then read `.agents/plans/FEATURE-EVALUATION-FRAMEWORK.md` and `docs/feature-evaluation-philosophy.md`.

## App Philosophy

- The shipped app is a browser-based plain text editor with live preview.
- Firenvim may own text editing inside the textarea. It does not own file identity, workspace state, save targets, server state, or command execution.
- The textarea value is the canonical in-app document text. Save, render, export, and plugin actions must use that value plus the app-tracked file path.
- The app owns filesystem interaction: open, new, save, workspace listing, selected-file tracking, and passing file paths to server-side tools.
- The app follows normal editor file semantics. It can open with no user file, edit and preview an unsaved buffer, then choose the real path on first save.
- Temporary files are internal backup state only. They are not user file identity, and they must not become the save target unless the user explicitly chooses that path.
- Nontrivial actions that need durable context must pass through the save gate first: plugin execution, opening another file, creating a new buffer, figure/asset actions, and any command that needs a path relative to the document.
- The app is renderer agnostic. The renderer command is entirely specified by config and may be Pandoc, a wrapper, a chained command, or an unrelated rendering CLI.
- Pandoc templates and filters are centralized assets. Expect them under `~/.pandoc/templates/` and `~/.pandoc/filters/`, referenced by config or wrappers.

## Hard Boundaries

- Do not add app-owned request fields, UI controls, or CLI parsing for renderer-specific arguments such as Pandoc templates, filters, formats, PDF engines, bibliography flags, or math flags. Put those in config or wrapper commands.
- Do not copy project-local template/filter paths into the app. Keep Pandoc-specific assets centralized under `~/.pandoc`.
- Do not build a Settings UI that edits renderer arguments unless the product decision is explicitly changed. A read-only renderer display can be considered separately.
- Do not infer file identity from Firenvim, nvim buffers, temporary files, or editor state. File identity belongs to the app/server state model.
- Do not let backup/recovery files satisfy the save gate. Backups preserve crash recovery; they do not establish document directory, plugin context, or asset paths.
- Do not create a real user file for `New` until the user saves content to the chosen path. `New` may record a pending target, but the first save must create the file with the current textarea content.
- Do not constrain Save As or New targets to the launch directory. Absolute user paths are valid save targets; relative paths resolve inside the current workspace.
- Keep workspace root state consistent with file identity. Saving within the current workspace must preserve that workspace; saving outside it must update reload, Explorer, and dialog state to the new file's directory.
- Tests for file workflows must prove exact disk paths and contents, reload persistence, workspace-root updates, and absence of stray files in the repo root.
- Do not preserve obviated feature cards as candidates. If Firenvim, nvim, the textarea, or the configured renderer already owns the full user outcome, delete the active card.
- Do not convert an obviated feature into nearby app work unless the user outcome still exists under the current architecture.

## Feature Evaluation

- Define features by user outcome, not by GUI widget.
- Before implementing, decide which layer owns the outcome: Firenvim/nvim, app/client, app/server, config, plugin manifest, or external renderer.
- Use mature existing dependencies for UI and execution boundaries already present in the app. Do not hand-roll framework behavior without a documented reason.
- Keep plugin commands separate from the preview renderer. Bundled plugins may declare their own commands and args because plugin manifests own those command declarations.

## Testing Rules

- Tests must prove repository-owned behavior with real execution. Do not use mocks, skips, or xfails to mask missing dependencies.
- Prefer a few dense workflow tests over many one-feature probes. A good browser test drives a realistic user process and asserts exact expected state after every meaningful transition: editor text, preview content, file identity, disk contents, save/render status, visible UI, and console errors.
- Do not keep tests that only prove internal consistency, such as `ok` flags, non-null values, or weak substring checks. Assert exact observable outcomes.
- For preview correctness, use Pandoc as the oracle. The proof is that content entered through the app appears in the preview iframe exactly as the configured renderer would emit it, not that an Express endpoint returned a plausible response.
- The server is mostly glue. Test it only for renderer parity/non-mangling or concrete app-owned filesystem/plugin boundaries. Do not build isolated server tests for trivial request/response plumbing.
- Keep tests separate only when they need clean state or are proving a specific bug boundary. Otherwise group related user behaviors into one realistic session and assert intermediate states heavily.
- Browser tests fail on console errors, not warnings.
- Run project checks through `just`; use the existing recipes for type-checking, building, and tests.
