# Proof Obligations and Test Philosophy

## Purpose

The test suite is a proof system for the app contract. It is not a collection of smoke checks, screenshots, mocks, or implementation-shaped probes.

Correct tests matter before passing tests. A test may fail because the app is wrong; that is useful. A passing test that does not prove the contract is harmful.

## Proof boundaries

There are three valid proof boundaries.

### Browser-smoke

Browser-smoke proves only that the shell/harness can load enough UI to begin testing.

It does not prove app features.

It does not discharge save, render, plugin, Git, diagram, or recovery obligations.

### Tauri

Tauri mode is the required boundary for feature proof.

It drives the real Tauri webview through `@srsholmes/tauri-playwright` plugin socket.

It must not use browser-mode IPC mocks.

It must not use generic Playwright assumptions that are not supported by the TauriPage surface.

### Rust/unit

Rust/unit tests prove backend logic that can be isolated without lying about the desktop boundary.

They are valid for parser, command construction, config validation, Git helpers, filesystem helpers, and other pure or backend-local logic.

They do not prove UI workflow behaviour.

## Test infrastructure requirements

The test infrastructure has been hacked by weak-model work and must be reoriented before feature proof runs.

Required constraints:

- use `@srsholmes/tauri-playwright` according to its documented examples;
- single Playwright worker;
- singleton desktop behaviour;
- `maxFailures: 1`;
- isolated temporary HOME, XDG, workspace, config, and session directories;
- real Pandoc;
- real TeX tools where required;
- real renderer commands;
- real Git;
- real generated config;
- real template and filter fixture files;
- no generic browser IPC mocking;
- no `page.route()` for feature proofs;
- no callback functions passed to `evaluate`;
- no `frameLocator`, because it is not in the TauriPage surface;
- no coordinate or bounding-box selectors;
- use `data-testid` and standard CSS selectors with high-level plugin APIs.

The harness must fail early with a clear diagnostic if required dependencies are missing. It must not skip or degrade tests.

## Banned testing patterns

The following patterns invalidate tests as correctness evidence:

- mocks;
- fakes;
- stubs;
- skips;
- xfails;
- source-policing tests;
- exact error-string assertions;
- helper-branch tests that do not exercise the public command;
- runtime defaults;
- fail-open branches;
- `as any`;
- `@ts-nocheck`;
- broad `Record<string, unknown>` casts to bypass type checking;
- browser-smoke tests presented as feature proofs;
- screenshots as assertions;
- IPC mocks for save/render/plugin/Git/diagram proof;
- tests that delete type safety;
- tests that assert that code text contains or does not contain a string instead of exercising behaviour.

Screenshots are build-time artifacts for user inspection. They are not assertions.

## Workflow-test shape

Prefer dense workflow tests over many single-feature probes.

The target shape is a small number of tests that each exercise several coupled obligations in one real app instance.

Examples of dense workflows:

1. **Temporary buffer to tracked file**
   - launch without file;
   - verify temporary file exists on disk;
   - verify it is in the backend recovery Git repo;
   - edit text;
   - observe autosave commit;
   - save as a real path;
   - verify file creation with current textarea content;
   - verify tracked/untracked indicator updates;
   - verify save commits.

2. **Renderer configuration**
   - provision `~/.pandoc/templates/pandoc_preview_template.html`;
   - provision required filters under `~/.pandoc/filters/`;
   - load settings;
   - toggle structured Pandoc controls;
   - verify raw command text is authoritative;
   - render through the real command;
   - verify nonzero renderer exit surfaces visibly.

3. **Plugin export**
   - open or create a saved document;
   - run export plugins;
   - verify real output files exist;
   - verify plugin stderr/stdout handling;
   - verify failed plugin returns structured error;
   - verify no success-shaped failure.

4. **Diagram and figure workflow**
   - ensure saved document;
   - use FreeTikZ/quiver extraction path;
   - insert at cursor;
   - create supported desktop diagram files;
   - verify global figures directory usage;
   - verify no per-document `./figures`;
   - verify Pandoc/filter layer owns rendering.

## Core proof obligations

### Document identity and recovery

- Launching without a user file creates an immediate temporary file on disk.
- That file is in the app’s internal Git-backed recovery store.
- It is not user-facing file identity.
- It is not the permanent save target unless explicitly chosen.
- Autosave commits edits at a sub-10-second cadence.
- Save As turns current textarea content into the selected real file.
- New may record a pending target, but first save creates that file with current textarea content.
- Opening another file or creating a new buffer passes through the save gate if the current buffer has unsaved changes.

### Save and Git

- For tracked files, Save writes bytes and creates a Git commit.
- For untracked files, the GUI prominently indicates untracked status.
- The untracked indicator prompts tracking.
- The backend recovery repo protects untracked or unsaved buffers.
- Save failures are structured errors.
- Git operations are real; tests must inspect real Git history.

### Renderer

- `render_command` is the single source of truth.
- Structured settings controls round-trip through the raw command string.
- Raw command text remains authoritative.
- The renderer command runs as configured.
- Nonzero renderer exit is failure.
- stderr is surfaced.
- render duration remains diagnostic metadata only.
- No fallback preview is substituted.

### Pandoc assets

- Templates are loaded from `~/.pandoc/templates/`.
- Filters are loaded from `~/.pandoc/filters/`.
- The configured template exists at test time.
- Filter fixtures exist at test time.
- Missing template or filter fails startup/config validation.
- App code does not embed template content.

### TikZ and figures

- TikZ is never rendered in-browser.
- TikZjax or equivalent is absent.
- TikZ rendering is delegated to server-side Pandoc/TeX/filter tooling.
- The Figure Library scans only the configured global figures directory.
- No per-document `./figures` workflow is introduced.
- FreeTikZ/quiver extraction inserts deterministic output at the editor cursor.
- Supported desktop tools are exactly the current supported set.
- Drawio and xournal remain absent.
- xournalpp is the supported Xournal-family tool.
- ipe is the drawing tool in scope.

### Plugins

- Plugins execute real commands.
- Plugin outputs are real files when the plugin contract says so.
- Plugin failures are structured failures.
- `Ok({ ok: false })` is banned.
- Plugins cannot run against temporary user-identity state without passing the save gate.

### Hover-to-edit

- Filters tag editable content with `.pandoc-preview-editable`.
- Tagged elements carry `data-edit-kind`.
- Template JavaScript sends messages to React via `postMessage`.
- App code does not embed content-specific parsing rules that belong in filters.

## Anti-gaming obligations

Tests must be capable of detecting fake success.

A test for file creation must assert that the file exists and has the correct content.

A test for Git commit must inspect real Git history.

A test for plugin execution must observe a real output or real error.

A test for renderer failure must observe a real nonzero exit and visible diagnostic.

A test for dependency presence must fail before feature testing begins if the dependency is missing.

Do not add meta-code whose only role is to document banned patterns. Banned patterns are enforced by proof shape and review, not by paperwork.

Do not delete slop without tracing the narrative that created it. Deletion without diagnosis launders the original unresolved problem.

## Active unresolved test work

The test suite must be fixed at the infrastructure level before feature runs.

Agents have repeatedly deviated from documented `tauri-playwright` usage. The root cause needs diagnosis.

Any socket-based implementation that diverges from standard docs requires review before it is accepted.

The codebase needs a coherence pass to ensure:

- no drawio references remain;
- no xournal references remain;
- no TikZjax references remain;
- no mock/suppress/launder patterns remain;
- config names match Rust-side Tauri v2 argument names;
- fixture templates and filters exist before tests reference them.
