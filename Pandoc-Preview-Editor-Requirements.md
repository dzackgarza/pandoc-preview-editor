# Pandoc Preview Editor Requirements

## Scope

This document records the application’s non-standard requirements. It omits ordinary desktop-editor behaviour unless that behaviour has project-specific consequences.

The app is bespoke software for one trusted Linux workstation. It is not a product platform, multi-user system, cross-platform editor, network service, or hardened document renderer.

## Core identity

The shipped app is a Tauri desktop application with a browser-based plain-text editor surface and live preview. CodeMirror is the in-app editor surface. Firenvim may own text editing inside the textarea, but it does not own file identity, workspace state, save targets, server state, command execution, rendering, plugins, or recovery.

The textarea value is the canonical in-app document text. Save, render, export, plugin execution, citation insertion, figure insertion, diagram insertion, and hover-to-edit must operate from this value plus the file path tracked by the app.

The app owns:

- file identity;
- open/new/save/save-as;
- workspace state;
- selected-file tracking;
- recent files;
- backend recovery state;
- passing document paths to renderer, plugin, Git, figure, diagram, and export commands.

The renderer is intentionally agnostic. The configured renderer may be Pandoc, a wrapper, a chained shell command, or an unrelated CLI. The app must not special-case Pandoc beyond providing structured convenience controls over the raw render command.

Dependencies are part of the design. Mature libraries and existing tools should be used directly. The app should not replace Pandoc, Git, CodeMirror, TeX tooling, mature file-type libraries, diagram editors, or the operating system.

## Document identity and temporary files

The app supports opening with no user-selected file. In that state, the app creates a temporary Markdown file on disk immediately. This file is part of the app’s internal Git-backed recovery store.

The temporary file is real disk state, but it is not the user-facing document identity. It must not become the permanent save target unless the user explicitly chooses that path.

The temporary file is aggressively autosaved. Autosaves are committed to the backend recovery repository. Recoverable work loss should be at most a few seconds.

The app may record a pending target for `New`, but first save must create that target with the current textarea content.

Nontrivial actions that need durable context must pass through the save gate first:

- plugin execution;
- export;
- opening another file;
- creating a new buffer;
- figure or asset actions;
- diagram actions;
- commands that need a path relative to the document.

The save gate resolves temporary state into user-facing document identity. Until that happens, the backend recovery repo protects the temporary file, but external actions must not treat it as the user’s chosen file.

## Save and Git model

The app is Git-native. Versioning, crash recovery, rollback, and emergency inspection are delegated to Git.

For tracked files, Save is a Git commit. A save that writes bytes but does not commit is not a successful save.

For untracked files and unsaved buffers, save and commit are split: the app writes and commits to the backend recovery repository until the user tracks or saves the file into a real location. This is a temporary condition, not an alternate workflow.

The GUI must prominently indicate whether the active file is tracked in a Git repository. An untracked indicator is a prompt to track the file.

Save As and New targets are not constrained to the launch directory. Absolute user paths are valid. Relative paths resolve inside the current workspace. Saving inside the current workspace preserves that workspace. Saving outside it updates Explorer and dialog state to the new file’s directory.

Git operations are local only. The app must not push, pull, merge, branch, or expose full Git project management. Git is used for recovery and versioning, not collaboration.

## Configuration

No runtime defaults in code. The app may ship an opinionated generated config, but runtime code must validate required values and fail if they are absent or malformed.

The render command string in config is the single source of truth for renderer invocation.

The app must not own separate config keys for renderer-specific flags. Structured controls in the settings UI are a quality-of-life layer that parses and reconstructs the render command string on read/write.

A raw command text tab must always exist and must be the authoritative view.

Pandoc templates and filters are centralized under `~/.pandoc/`. They are version-controlled like dotfiles for academic reproducibility.

The app enforces this centralization. Structured UI may resolve template and filter flags only through the configured `templates_dir` and `filters_dir`.

Templates are data, not code. No app code may embed template contents or build templates through string manipulation.

The default template path is:

```text
~/.pandoc/templates/pandoc_preview_template.html
```

Pandoc filters live in:

```text
~/.pandoc/filters/
```

The app must assert configured template and filter existence at startup.

Test fixtures must provision all referenced templates and filters. A test that references a nonexistent Pandoc asset is invalid.

## Rendering

Rendering is driven only by the configured render command.

Renderer stdout is preview HTML. Renderer stderr is diagnostic output. A nonzero renderer exit is a failed render.

Render duration is diagnostic metadata only. It is never part of the operation’s core success/failure contract.

The app must not suppress stderr, synthesize fallback preview HTML, or convert renderer failures into falsey values.

The app does not implement XSS prevention, HTML sanitization, or execution sandboxing. The rendered preview is trusted local output.

## TikZ, diagrams, and figures

TikZ diagrams are rendered to SVG through server-side Pandoc/TeX/filter tooling only. In-browser TikZ engines such as TikZjax are banned.

Server-side Pandoc-to-SVG rendering is required because it is auditable, respects TeX layout, handles text-vs-drawing scaling correctly, and compiles through the same pipeline used for the document.

Deep integration with TikZ generation tools is core app identity, not a convenience afterthought. The app must provide one-button access, deterministic extraction, and direct cursor injection for supported tools such as FreeTikZ and quiverapp.

The app must not specially render TikZ itself. TikZ rendering belongs to the Pandoc/filter/template layer.

The global figures directory is a configured centralized directory. The Figure Library scans this global directory exclusively.

No per-document `./figures/` directories.

Supported drawing/diagram tools:

- FreeTikZ;
- quiverapp;
- Qtikz;
- Tikzit;
- Inkscape;
- xournalpp;
- ipe.

Dropped or banned:

- drawio;
- xournal;
- TikZjax;
- generic in-browser TikZ rendering.

## Hover-to-edit

Hover-to-edit is a content-layer feature. It belongs to the Pandoc template/filter layer, not app code.

Pandoc filters tag interactive elements with:

```html
class="pandoc-preview-editable"
```

and a `data-edit-kind` attribute.

Modular JavaScript in the template listens for clicks on tagged elements and communicates with React via `postMessage`.

The app receives those messages and maps them back to editor actions. The app must not own content-specific parsing rules that belong in filters.

## Plugins and exports

Plugins are real command executions. They are not mocks, stubs, or synthetic UI actions.

Plugin execution requires a real document path. Temporary buffers must pass through the save gate before plugins run.

Bundled export plugins include HTML, LaTeX, and PDF export. They must use the canonical textarea value and app-tracked file path.

A plugin run must return structured success or structured failure. It must not return success-shaped failure values.

## Error handling

IPC responses must use structured result types.

`Ok` means the operation succeeded. Failures are returned as structured errors.

Do not return `Ok({ ok: false, ... })`.

Do not convert errors to `null`, `undefined`, empty strings, empty arrays, booleans, or other falsey values.

Do not suppress errors.

Do not catch exceptions unless the error is surfaced visibly and structurally.

Malformed config, missing required files, missing templates, missing filters, missing required commands, and nonzero renderer exits must fail visibly.

## Trust model

The app runs on one trusted Linux machine for one user.

It is not hardened against attackers.

It does not attempt to prevent XSS.

It does not sanitize or validate Pandoc preview HTML.

It does not sanitize or validate HTML loaded by diagram tools.

It does not use dynamic ports as a security measure.

It does not implement sandboxing.

Enterprise security patterns are out of scope.

The actual threat is future work degrading the codebase: silent fallbacks, mock proofs, default-laundering, test-gaming, accidental feature regressions, hidden state, unclear ownership, and code that becomes harder to reason about.

## Dropped features

The following are not merely unimplemented. They are dropped or banned requirements:

- drawio support;
- xournal support;
- TikZjax or other in-browser TikZ rendering;
- Express-based preview server;
- multi-platform support;
- horizontal scaling;
- input sanitization or XSS hardening;
- enterprise security theatre;
- error suppression of any kind.
