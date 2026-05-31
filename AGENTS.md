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
- Academic reproducibility is a core design constraint. Pandoc assets (templates, filters, macros, styles, CSL files) must live under `~/.pandoc/` and be version-controlled like dotfiles, so that paper compilations remain reproducible after system changes (new machine, new institution). The app enforces this centralization as a hard rule: the structured UI resolves template and filter flags exclusively through the configured `templates_dir` and `filters_dir`, and deliberately prevents attaching filters or templates from arbitrary filesystem locations. The raw command tab bypasses this enforcement but is not the advertised workflow.
- Templates are data, not code. Pandoc templates, TikZ wrappers, macros, and style sheets are user-editable files stored under `~/.pandoc/` or the app's config directory. No app code may embed template content or construct templates through string manipulation. When a new macro package is released or a style needs updating, the user edits a file — no code change, no deployment.
- TikZ diagrams are rendered to SVG via Pandoc on the server side, never through an in-browser JavaScript engine (tikzjax or equivalent). TikZjax lacks full TikZ feature coverage, does not support user macros, is outside the app's template control, and — most critically — produces output that is not reproducible outside the app. Server-side Pandoc → SVG rendering is externally auditable, handles text vs drawing scaling correctly, and compiles identically on any machine.
- The app uses a fail-fast architecture. Unexpected state at any layer must crash promptly and visibly — never silently degrade, never substitute fallback defaults. Silenced errors today become unrecoverable research data loss tomorrow. A broken build is always cheaper than corrupted output.
- The app is git-native. Versioning, crash recovery, and rollback are delegated to git rather than reinvented. The GUI prominently indicates whether the active file is tracked in a git repository. For a tracked file, saving and committing are the same operation — the save IS a git commit. For an untracked file (not in git at all, or inside a repo but never committed) or an unsaved buffer, save and commit necessarily split: the backend writes to its own recovery repo. The prominent untracked indicator is a prompt to track the file in git; the split is a temporary condition, not a normal workflow. The backend additionally autosaves the current buffer on a short internal timer (sub-10-second debounce) and commits every autosave, so that the maximum recoverable work loss from any crash is a few seconds of editing. Commits per save are negligible on modern systems; agents can squash and clean history during maintenance.

## Hard Boundaries

- Do not add app-owned config keys for renderer-specific flags. The `render_command` string in config is the single source of truth for the renderer invocation. The canonical workflow is: develop and verify a Pandoc command in the terminal first, then paste it into the app config. The app consumes the working command; it is not a Pandoc flag builder. UI convenience controls are an ephemeral view layer that helps *manage* the resulting long command string — they parse the string on read and reconstruct it on write, never persisting independent flag fields to config.
- Do not copy project-local template/filter paths into the app. Keep Pandoc-specific assets centralized under `~/.pandoc`.
- The Settings UI may provide structured controls for common Pandoc flags — standalone, citeproc, TOC, number-sections, embed-resources, math engine, template selection, filter toggles — as a QOL layer on top of the command string. Its purpose is to help users discover available flags, browse their centralized templates and filters, and modify their long-running preferred Pandoc invocation without consulting the Pandoc manpage for every option. Every edit to a structured control must immediately reconstruct and display the equivalent command string. The raw command text tab must always be available as the authoritative view.
- Never catch an exception without surfacing it visibly to the user. No silent error swallowing, no fallback defaults, no graceful degradation that masks an unexpected condition. Crash immediately — a broken preview is recoverable, corrupted research output is not.
- Assert every invariant at the boundary where data enters the system: config parse results, file paths, renderer exit codes, template and filter existence. A null or missing value is a hard failure, not a default to log and ignore.
- Do not embed template content in app code or construct templates through string manipulation. Templates are user-editable data files referenced from the render command, never owned by application code. For TikZ rendering, a standard Pandoc template in `~/.pandoc/` serves as the injection point; the app does not generate or mutate template content.
- Do not use in-browser TikZ rendering (tikzjax or any equivalent). All TikZ must be rendered to SVG via Pandoc on the server side, never through a JavaScript engine in the browser. The resulting SVG is embedded as an image in the preview output.
- Do not infer file identity from Firenvim, nvim buffers, temporary files, or editor state. File identity belongs to the app/server state model.
- Do not let git recovery history satisfy the save gate. The backend recovery repo and the user's git history preserve crash recovery; they do not establish document directory, plugin context, or asset paths.
- Do not implement app-owned crash recovery that duplicates git. The backend recovery repo is the crash recovery layer — no separate temporary-file backup formats, no app-owned snapshot system.
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
