# Testing Proof Obligations for the Tauri Refactor

This document reconstructs the functionality proofs that were deleted during the Express -> Tauri refactor and turns them into a forward-facing test specification for the current app.

It does **not** prescribe implementation details or test helpers.
It defines what the suite should **prove** about real owned behavior.

## Sources consulted

- Current repo philosophy and feature-evaluation docs.
- Current live test suite:
  - `src-tauri/src/command_flags.rs`
  - `src-tauri/src/config.rs`
  - `src-tauri/src/fs_utils.rs`
  - `src-tauri/src/render.rs`
  - `src-tauri/src/commands/plugins.rs`
  - `src/tests/e2e/app.spec.ts`
- Deleted Playwright suites from git history, especially:
  - `src/tests/file.spec.ts`
  - `src/tests/user-behaviors.spec.ts`
  - `src/tests/settings.spec.ts`
  - `src/tests/plugins.spec.ts`
  - `src/tests/diagram-workflow.spec.ts`
  - `src/tests/renderer-diagnostics.spec.ts`
  - `src/tests/file-selector.spec.ts`
  - `src/tests/session-persistence.spec.ts`
  - `src/tests/config-loading.spec.ts`
  - `src/tests/e2e.spec.ts`
  - `src/tests/tikz-filter.spec.ts`

## Testing stance

Per the repo philosophy and `testing-guidelines`, the suite should prove **real user-facing behavior at real boundaries**:

- Prefer **real Playwright workflows** over endpoint-shape tests.
- Prefer **real Tauri desktop boundaries** over mocked IPC.
- Use **real temp workspaces, real files, real Pandoc, real plugin commands, real clipboard events, real config files**.
- Avoid mocks as much as humanly possible.
  In particular:
  - no `page.route(...)` to fake server success/failure for core workflows;
  - no mocked Tauri `invoke(...)` for feature proofs;
  - no “API returns JSON” tests that do not also prove an app-owned user outcome.

The current `browser-smoke` test is still useful as a harness smoke check, but because it uses explicit Tauri IPC mocks it should **not** be counted as proof of application functionality.

## Relationship to Migration and Pass/Fail Status

This document is the proof-obligation specification.
It does not track migrated-file inventory and does not report whether the app currently passes the suite.

Use the documents in this order:

- `.agents/plans/port-e2e-tests-from-main.md` tracks the migration from old Express tests to current Tauri tests.
- This document defines the behavior burden that the migrated suite must model.
- The migration plan must repair the suite until tests are admissible proofs, not just present files.
- `just test` becomes an app-satisfaction gate only after the migrated suite is correct, complete, and free of the banned patterns below.

Before that point, a failing test run may expose useful defects, but it is not a substitute for the suite-completeness audit.

## Suite Correctness Rules

A migrated test is acceptable only after the test body satisfies these conditions:

- The E2E test code type-checks against its real APIs.
- The test uses the Tauri Playwright plugin as the desktop boundary: `createTauriTest`, `mode: 'tauri'`, `TauriPage`, and interaction APIs supported by that adapter.
- The test proves behavior with real objects: real Tauri IPC, real temp workspaces, real files, real TOML config, real renderer commands, real plugin commands, and real editor/preview interaction.
- The assertions name exact observable outcomes: editor text, preview content, file identity, disk contents, save/render/plugin state, visible diagnostics, and console errors where relevant.
- The proof claim can be stated in one sentence: this test proves that this repository owns and correctly performs a specific behavior.

## Banned Test Patterns

Future suite work must reject these patterns in review and documentation:

- whole-file type suppression: `// @ts-nocheck`, `// @ts-ignore`, or equivalent;
- `as any`, `: any`, and untyped helpers where a real app/test type is known;
- loose `Record<string, unknown>` assertions for known IPC/config/session payloads;
- CJS `require()` in ESM tests;
- empty, comment-only, or diagnostic-swallowing `catch` blocks;
- `test.skip`, conditional skips, xfails, or dependency-gated feature disappearance;
- `page.route(...)`, mocked Tauri `invoke`, synthetic IPC responses, or fake app state for feature proofs;
- mocked browser-smoke tests counted as proof-obligation coverage;
- duplicated local helpers that weaken shared polling, typing, or boundary behavior;
- route-shape, JSON-shape, non-null, count-only, or “visible exists” assertions used as substitutes for exact user-visible outcomes;
- unsupported Playwright/Tauri adapter calls hidden behind type casts;
- tests that mutate expected behavior to match the current app instead of proving the documented behavior.

## Failed-Test Debugging Contract

A failing test is not automatically evidence that the app is wrong.
Before editing app code, assertions, fixtures, helpers, timeouts, or adapter calls, classify the first incorrect boundary:

- **App defect:** the test is a correct real-boundary proof and the app violates the documented contract.
- **Incorrect test:** the assertion contradicts repo architecture, documented proof obligations, real data shape, or a working app pattern.
- **Harness misuse:** the failure comes from unsupported Tauri Playwright usage, browser-mode assumptions in Tauri mode, lifecycle confusion, or type escapes.
- **Fixture/config defect:** the test creates impossible state, omits hard dependencies, leaks XDG/HOME/session state, or asserts on fixture setup rather than user-visible behavior.
- **Invalid proof design:** the test can pass without proving owned behavior, uses mocks for a feature proof, asserts only shape/existence, depends on arbitrary timing, or preserves obsolete Express/TikZJax/static-server semantics.

Every failed-test repair must leave a visible causal note with:

- exact command, spec, project, environment, and artifacts inspected;
- complete stdout/stderr, browser console, Tauri/Rust stderr, renderer stderr, screenshots/traces/videos, and relevant process observations;
- the proof obligation being tested;
- the first boundary where actual state diverges from expected state;
- competing app/test/harness hypotheses and the observation that eliminated each one;
- the reason the final edit addresses the established cause.

Repeated hacking is a failure mode.
After two failed fix attempts on the same test, stop editing and review the causal note.
Do not get to green by increasing timeouts, adding retries, narrowing assertions, switching to mocked IPC, deleting/skipping the test, adding local duplicate helpers, swallowing diagnostics, or changing expectations to match current broken behavior.

## Old tests that should not be recreated verbatim

Some deleted tests encoded obsolete architecture or weak proof shapes and should be replaced, not resurrected:

1. **Express endpoint contract tests**
   - Old `/api/...` tests should become Tauri-owned workflow proofs, not route-shape snapshots.

2. **Central figures registry / central figures directory**
   - The current app owns document-relative `./figures/`, not central storage.

3. **tikzjax client-rendering proofs**
   - The current architecture explicitly forbids browser-side TikZ rendering.

4. **MIME/static-asset server proofs**
   - Those were proving Express-era serving behavior, not the current Tauri app.

5. **Timing theater**
   - The suite should prove causality (“latest edit wins”), not arbitrary latency numbers.

6. **Route-interception error tests**
   - Old tests that used `page.route(...)` to fake 500s are not acceptable as primary proofs.
     If the failure mode matters, reproduce it with a real failing renderer, real conflicting file, real missing tool, or real bad config.

## Proof obligations the recovered suite should cover

Each item below is phrased as a repository-owned guarantee.
Unless noted otherwise, each should be proved with real Playwright interaction against the real Tauri app plus real filesystem/process boundaries.

### P0: Core editor and file-identity workflows

1. **Open -> edit -> render -> save -> reload is one continuous file-owned workflow**
   - Prove that launching with a real document loads disk content into the editor and preview, saving writes the current textarea value to that same file, reload keeps the same active file, and preview/status reflect the saved state.
   - Historical source: `file.spec.ts`, `user-behaviors.spec.ts`.

2. **An unsaved buffer becomes a real file only on first save**
   - Prove that a new/untitled buffer can be edited and previewed without a user file, and that the first save writes the current textarea content to the chosen path without creating stray files elsewhere.
   - Historical source: `file.spec.ts`, repo philosophy.

3. **Save As preserves or updates workspace root correctly**
   - Prove both cases:
     - saving inside the current workspace keeps the same workspace root;
     - saving outside it moves the workspace root, explorer state, and reload identity to the new directory.
   - Historical source: `file-selector.spec.ts`, `user-behaviors.spec.ts`, repo philosophy.

4. **Explorer browsing owns file selection and save target identity**
   - Prove that the explorer shows the real workspace tree, ignores hidden/ignored/binary debris, opens nested files, and makes subsequent saves target the opened file rather than the previously active file.
   - Historical source: `file.spec.ts`, `file-selector.spec.ts`.

5. **Dirty-buffer replacement decisions are exact**
   - Prove that opening another file, creating a new file, or quick-opening while dirty triggers the unsaved-changes dialog and that each branch does exactly the right thing:
     - **Cancel** leaves editor, preview, file identity, and disk unchanged.
     - **Discard** swaps to the new target without writing the old buffer.
     - **Save** persists the current buffer first, then completes the requested action.
   - Historical source: `bug-fixes.spec.ts`, `user-behaviors.spec.ts`.

6. **External modification protection is real**
   - Prove that if the active file is changed on disk outside the app, the next save is rejected visibly and does not overwrite the external change.
   - Historical source: `file-integrity.spec.ts`.

7. **beforeunload warning matches dirty state**
   - Prove that a dirty document triggers a real unload warning and a clean one does not.
   - Historical source: `bug-fixes.spec.ts`.

### P0: Recovery and persistence

8. **Unsaved work survives reload and restart**
   - Prove both:
     - page reload restores the unsaved editor buffer;
     - restarting the app restores the last active file and its unsaved backup content.
   - The proof must use real state directories and real restarts, not in-memory fixtures.
   - Historical source: `session-persistence.spec.ts`.

9. **Initial state reports real file identity correctly**
   - Prove that startup distinguishes:
     - saved tracked file,
     - temp buffer,
     - recovered-from-backup session.
   - This should be visible through observable UI state, not only command return JSON.
   - Historical source: `file.spec.ts`, `session-persistence.spec.ts`.

### P0: Rendering and preview correctness

10. **The preview is a faithful live view of real renderer output**
    - Prove that a representative torture document typed through the editor appears in the preview with the expected semantic elements: headings, theorem/proof blocks, lists, tables, links, task lists, and math.
    - This should go through the actual app render path, not only the Rust render helper.
    - Historical source: `e2e.spec.ts`, `render.rs`.

11. **Latest edit wins**
    - Prove that if the user makes rapid successive edits, stale render results never overwrite the newest preview.
    - This is the user-facing version of the old “responsiveness” concern and is still an owned guarantee.
    - Historical source: old `responsiveness.spec.ts`, current `renderVersion` logic.

12. **Renderer failures surface actionable diagnostics and recover cleanly**
    - Prove that a real failing renderer shows visible error status plus detailed stderr, and that after restoring a valid render command the diagnostics panel disappears and the preview/status return to ready.
    - Use a real failing local renderer command, not a mocked HTTP failure.
    - Historical source: `renderer-diagnostics.spec.ts`.

### P0: Settings and config round-trips

13. **Preferences reflect, edit, and persist real config**
    - Prove that opening Settings reflects the current TOML-backed config, structured controls update the raw command tab, raw command edits rehydrate the structured controls, Apply writes to disk, and the new config actually affects subsequent renders.
    - Historical source: `settings.spec.ts`.

14. **Config path restrictions are enforced at the user boundary**
    - Prove that the structured Settings UI rejects templates and filters outside the configured Pandoc asset directories, while valid in-directory assets are accepted.
    - Historical source: `command-parsing.spec.ts`, `settings.spec.ts`.

15. **Startup config discovery is real**
    - Prove that the app creates a default config in XDG config space when none exists and preserves an existing config rather than overwriting it.
    - Historical source: `config-loading.spec.ts`.

### P0: Plugins, exports, and save-gated commands

16. **Plugins run against the app-owned file path, not a temp fiction**
    - Prove that export plugins run against the active document path chosen by the app, write outputs next to that document, and produce outputs matching an independent oracle such as direct Pandoc invocation.
    - Historical source: `plugins.spec.ts`.

17. **Plugin save gate is enforced**
    - Prove that running a plugin from an unsaved buffer forces the user through the save gate first, and that cancelling the save leaves the plugin unrun.
    - Historical source: `plugins.spec.ts`, `bug-fixes.spec.ts`.

18. **Plugin success and failure surface correct UI state**
    - Prove that plugin state transitions are visible (`running` -> `idle`), success toasts expose the output artifact, and real plugin failures surface visible errors without leaving the UI stuck in a running state.
    - Historical source: `plugins.spec.ts`, `bug-fixes.spec.ts`.

### P0: Figures, clipboard, and diagrams

19. **Clipboard image insertion writes exact bytes into document-relative `figures/`**
    - Prove that pasting or explicitly inserting an image:
      - requires a saved document;
      - writes the real clipboard bytes into `./figures/`;
      - inserts the corresponding markdown into the editor;
      - renders correctly in preview.
    - Historical source: `user-behaviors.spec.ts`, current `save_figure_asset`.

20. **Diagram creation is save-gated and document-relative**
    - Prove that creating a diagram from an unsaved buffer is blocked, while creating one from a saved document writes the correct starter file into `./figures/` and inserts the correct relative reference into the document.
    - Historical source: `diagram-workflow.spec.ts`, current diagram refactor.

21. **Figures library reflects the workspace, not hidden app state**
    - Prove that the figures sidebar scans the actual workspace for assets under `figures/` directories, lists them with the expected kinds, and opens the selected figure for editing.
    - This is the modern replacement for the deleted central-registry proof.
    - Historical source: `diagram-workflow.spec.ts`, current `figures_registry`.

22. **Preview figure interactions map back to the correct source asset**
    - Prove that interacting with a previewed figure launches editing for the actual underlying figure file, not a guessed or stale path.
    - Historical source: old preview hover/edit coverage, current `PreviewPane`.

### P0: Academic-rendering boundaries

23. **TikZ is rendered server-side to static SVG**
    - Prove that a real `tikzcd` block renders as SVG in preview and does **not** depend on tikzjax or client-side script injection.
    - Historical source: `tikz-filter.spec.ts`.

24. **TikZ auxiliary file resolution works in real documents**
    - Prove that `\\input{...}` inside TikZ and `pdf_tex` overlay workflows resolve relative to the document and produce the expected rendered output.
    - Historical source: `tikz-filter.spec.ts`.

### P1: OS integration and secondary workflows

25. **Quick Open drives a real launcher pipeline**
    - Because quick-open is still a live user-facing feature (`Ctrl/Cmd+P` and `quick_open_spawn` remain wired), the suite should prove:
      - a configured launcher can return a chosen file and the app opens it;
      - launcher cancellation is treated as cancellation, not error;
      - missing launcher/tooling surfaces a visible failure.
    - Historical source: `architectural-regression.spec.ts`, current `quick_open_spawn`.

26. **Citation insertion uses the citation boundary, not the save boundary**
    - Prove that the citation command inserts a returned citation at the cursor and does not accidentally trigger save or file-selection UI.
    - This should use a real local Zotero-compatible endpoint or other real boundary, not a route mock.
    - Historical source: `bug-fixes.spec.ts`, current `zotero_cite`.

27. **Status chrome is trustworthy during a real editing session**
    - Prove that save state, render state, plugin state, saved timestamp, duration, and line count move coherently through a realistic session rather than only existing in isolation.
    - Historical source: `user-behaviors.spec.ts`.

## Suggested suite grouping

The recovered suite should be organized by user workflows, not by thin endpoint slices:

1. `desktop-file-workflows.spec.ts`
   - open/save/save-as/new/explorer/dirty-replace/external-modification/reload

2. `desktop-recovery.spec.ts`
   - backup persistence, reload/restart recovery, startup identity

3. `desktop-rendering.spec.ts`
   - torture-document preview, latest-edit-wins, diagnostics/recovery

4. `desktop-settings.spec.ts`
   - settings round-trip, path restrictions, XDG config discovery

5. `desktop-plugins.spec.ts`
   - export parity, save gate, output artifact opening, plugin-state transitions

6. `desktop-figures-and-diagrams.spec.ts`
   - clipboard insertion, paste flow, figure library, diagram creation, preview edit

7. `desktop-academic-rendering.spec.ts`
   - tikzcd, `\\input{...}`, `pdf_tex` overlays

8. `desktop-os-integration.spec.ts`
   - quick open, citation insertion

## Bottom line

The deleted suite, despite some Express-era and mock-heavy artifacts, was trying to prove a much larger owned surface:

- file identity
- save semantics
- workspace transitions
- recovery
- settings persistence
- plugin execution
- figure/diagram workflows
- diagnostics
- academic rendering boundaries

The migrated suite must model these proofs through **real Playwright user workflows against the live Tauri app**, with mocks treated as a last resort rather than the default testing strategy.
Whether the app satisfies those proofs is a later pass/fail question.
