# E2E Test Consolidation Plan

Goal: Maximize launch amortization by grouping "thin" tests into dense, workflow-driven specs. Remove redundant existence/shape checks and minimize use of `invokeTauri` where UI interactions are available.

## 1. `src/tests/e2e/workflow-editing.spec.ts`
**Consolidates:** `user-behaviors.spec.ts`, `desktop-file-workflows.spec.ts`, `workflows.spec.ts` (editing/file parts).
**Workflow:**
- Launch with a saved file.
- Verify initial state (editor, preview, status).
- Edit content (typing, paste, undo/redo).
- Verify preview updates and status (unsaved).
- Save file and verify disk content.
- Reload and verify persistence.
- Explorer navigation: switch to another file, verify "Unsaved Changes" dialog.
- Save-as to a new location (inside and outside workspace).
- Backup recovery test: make dirty, reload, verify backup restoration.

## 2. `src/tests/e2e/workflow-config.spec.ts`
**Consolidates:** `config-loading.spec.ts`, `command-parsing.spec.ts`, `settings.spec.ts`, `workflows.spec.ts` (config parts).
**Workflow:**
- Launch with default/missing config (verify creation).
- Update config via IPC (`set_config`) and verify `get_config`.
- Open Preferences UI.
- Toggle Pandoc settings (citeproc, standalone, etc).
- Verify "Raw Command" updates in real-time.
- Apply settings and verify persistence to disk and runtime.
- Verify path validation (rejection of external templates/filters).

## 3. `src/tests/e2e/workflow-extensions.spec.ts`
**Consolidates:** `plugins.spec.ts`, `diagram-workflow.spec.ts`, `tikz-filter.spec.ts`, `mime-types.spec.ts`, `workflows.spec.ts` (plugin/diagram parts).
**Workflow:**
- List plugins and diagram tools (substantive check).
- Open Diagram Modal.
- Create a TikZ diagram and verify editor insertion + file creation.
- Paste an image from clipboard and verify asset creation.
- Run Export plugins (HTML, LaTeX, PDF) and verify output.
- Test TikZ filter rendering in preview.

## 4. `src/tests/e2e/workflow-diagnostics.spec.ts`
**Consolidates:** `renderer-diagnostics.spec.ts`, `architectural-regression.spec.ts`.
**Workflow:**
- Trigger renderer error (broken command).
- Verify diagnostics overlay and status bar error state.
- Verify recovery after fixing command.

## Deletion List
- `architectural-regression.spec.ts`
- `bug-fixes.spec.ts` (Fold specific regressions into relevant workflows)
- `command-parsing.spec.ts`
- `config-loading.spec.ts`
- `desktop-file-workflows.spec.ts`
- `desktop-smoke.spec.ts`
- `diagram-workflow.spec.ts`
- `editor-height.spec.ts`
- `file-integrity.spec.ts`
- `file-selector.spec.ts`
- `mime-types.spec.ts`
- `plugins.spec.ts`
- `proof-loop.spec.ts`
- `renderer-diagnostics.spec.ts`
- `session-persistence.spec.ts`
- `settings.spec.ts`
- `tikz-filter.spec.ts`
- `user-behaviors.spec.ts`
- `workflows.spec.ts`

## Verification
- Run `just test` (specifically Playwright E2E).
- Ensure all substantive proof obligations are still met.
