# Suite Inventory — 19 E2E Spec Files

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-03
**Purpose:** Gate 1 audit — disposition of every spec against current Tauri architecture.

Each spec is classified: `tauri-proof` (real Tauri IPC, required for feature proofs),
`browser-smoke` (mocked IPC, harness-only), or `pending-removal` (obsolete shape).

---

## Browser-Smoke (Mocked IPC — harness check only)

### 1. `app.spec.ts` (2,467 bytes)
- **Disposition:** browser-smoke. The ONLY file permitted to use IPC mocks.
- **Mode:** Runs exclusively in `browser-smoke` Playwright project via `test.skip`.
- **Content:** Mocks `__TAURI_INTERNALS__` with `get_initial_state`, `render`, `list_files`, `figures_registry`.
- **Assertion:** Editor shell and preview pane are visible, status shows "ready".
- **Obsolete shapes:** None. The mocks are intentionally declared for smoke testing.
- **Notes:** Uses `test.skip` — intentional gate; not a bypass.

---

## Tauri Proofs (Real IPC)

### 2. `desktop-smoke.spec.ts` (389 bytes)
- **Disposition:** tauri-proof.
- **Content:** Single test: mounts live Tauri editor shell without mocked IPC.
- **Assertion:** `editor`, `preview-pane`, and `#status` with "ready" are visible.
- **Obsolete shapes:** None. Clean, minimal.

### 3. `editor-height.spec.ts` (1,425 bytes)
- **Disposition:** tauri-proof.
- **Content:** CodeMirror height fills available section area, not content-only height.
- **Assertion:** `boundingBox()` heights >100px; persists after minimal content.
- **Obsolete shapes:** None.

### 4. `proof-loop.spec.ts` (3,531 bytes)
- **Disposition:** tauri-proof. Core boundary test.
- **Content:** Renders torture.md → pandoc HTML; verifies structural elements and inline math.
- **Assertion:** Preview contains headings (Theorem, Proof, Definition), table content ("rank"), task items, links. Inline math renders via MathJax.
- **Obsolete shapes:** None. This is the central correctness proof.

### 5. `mime-types.spec.ts` (1,287 bytes)
- **Disposition:** tauri-proof. **Filename is misleading** — tests asset loading, not MIME types.
- **Content:** Verifies compiled JS/CSS assets load (not raw .tsx source).
- **Assertion:** `<script src>` attributes lack `.tsx`; at least one compiled JS and CSS asset present.
- **Obsolete shapes:** None in content. File renaming recommended.
- **Notes:** Historical name from Express-based server; should be renamed to `asset-loading.spec.ts`.

### 6. `renderer-diagnostics.spec.ts` (3,021 bytes)
- **Disposition:** tauri-proof.
- **Content:** Renderer failure → diagnostics panel display → recovery on good config.
- **Assertion:** Diagnostics panel shows exact stderr content; panel disappears after successful render.
- **Obsolete shapes:** None.

### 7. `architectural-regression.spec.ts` (4,536 bytes)
- **Disposition:** tauri-proof.
- **Content:** Verifies pandoc renderer preserves src attributes, comments, and scripts without mangling.
- **Assertion:** Exact src values preserved across relative, absolute, data-URI, protocol-relative, empty, and single-quoted paths.
- **Obsolete shapes:** None. Tests current render-path behavior.

### 8. `bug-fixes.spec.ts` (7,630 bytes)
- **Disposition:** tauri-proof.
- **Content:** TDD bug fixes: exact path match in Explorer highlighting, UnsavedChangesDialog workflow (Cancel/Discard/Save), plugin prompt for unsaved buffer, workspace root defaults.
- **Assertion:** Exact file identity, save/discard semantics, dialog visibility and content.
- **Obsolete shapes:** None.

### 9. `config-loading.spec.ts` (5,042 bytes)
- **Disposition:** tauri-proof.
- **Content:** Config TOML initialization, load, custom values, non-overwrite, set_config persistence.
- **Assertion:** Exact TOML content, runtime state matches disk, debounce/timeout/command values.
- **Obsolete shapes:** None.

### 10. `diagram-workflow.spec.ts` (4,159 bytes)
- **Disposition:** tauri-proof.
- **Content:** Diagram tool listing, pandoc assets, create_diagram_file (save-gate rejection + success), diagram_proxy.
- **Assertion:** Tool IDs present, filter array type, file creation with tikzpicture template, proxy injects overlay.
- **Obsolete shapes:** None.

### 11. `file-integrity.spec.ts` (3,887 bytes)
- **Disposition:** tauri-proof.
- **Content:** Atomic write, external modification detection, save-reload preservation.
- **Assertion:** Exact disk content match after save; external edit blocks overwrite; reload preserves content.
- **Obsolete shapes:** None.

### 12. `file-selector.spec.ts` (5,293 bytes)
- **Disposition:** tauri-proof.
- **Content:** Save As dialog, directory navigation, file listing, click-to-populate, browse IPC.
- **Assertion:** Breadcrumb reflects navigation, file saved to exact path, browse returns correct entries.
- **Obsolete shapes:** None.

### 13. `command-parsing.spec.ts` (13,015 bytes)
- **Disposition:** tauri-proof.
- **Content:** Pandoc flag parsing, filter listing, set_config flag updates, Settings dialog bidirectional sync (checkboxes ↔ raw command), Lua filter toggle.
- **Assertion:** Parsed flags match command string, TOML persistence, checkbox state sync.
- **Obsolete shapes:** None.

### 14. `session-persistence.spec.ts` (7,325 bytes)
- **Disposition:** tauri-proof.
- **Content:** Last-file restore, session state match, backup recovery, unsaved buffer recovery on reload, restore_last_file=false behavior.
- **Assertion:** Exact file path in footer and state JSON, backup file existence and content, recoveredFromBackup flag, null file when restore disabled.
- **Obsolete shapes:** None.

### 15. `settings.spec.ts` (7,397 bytes)
- **Disposition:** tauri-proof.
- **Content:** Settings dialog bidirectional sync, tab set completeness, set_config via invoke, template path validation.
- **Assertion:** Dialog dimensions, all 5 tabs present, checkbox ↔ raw command sync, external template rejection.
- **Obsolete shapes:** None.

### 16. `tikz-filter.spec.ts` (4,118 bytes)
- **Disposition:** tauri-proof.
- **Content:** Server-side TikZ rendering (NOT tikzjax), tikzcd SVG, \input{} recursion, pdf_tex overlay.
- **Assertion:** SVG present with <path>/<line>/<rect>, NO tikzjax.js or fonts.css, SVG after \input resolution.
- **Obsolete shapes:** None. Explicitly asserts against tikzjax (correctly, as negative proof).

### 17. `plugins.spec.ts` (6,110 bytes)
- **Disposition:** tauri-proof.
- **Content:** Plugin listing (stripped of internals), save-gate rejection, HTML/LaTeX/PDF export with pandoc oracle parity.
- **Assertion:** Plugin metadata shape, export output matches pandoc oracle byte-for-byte, PDF starts with %PDF-.
- **Obsolete shapes:** None.

### 18. `desktop-file-workflows.spec.ts` (10,523 bytes)
- **Disposition:** tauri-proof.
- **Content:** Saved-file launch/save/reload cycle, Save As workspace-inside and workspace-outside updates, Explorer debris filtering, file switching with dirty-buffer dialog.
- **Assertion:** Exact file identity across transitions, disk contents, workspace root updates, Explorer filtering.
- **Obsolete shapes:** None.

### 19. `user-behaviors.spec.ts` (13,128 bytes)
- **Disposition:** tauri-proof.
- **Content:** Full editing session (type/save/reload/status), rapid typing with undo, Explorer file browsing with UnsavedChanges dialog, image paste workflow.
- **Assertion:** Exact editor contents, preview text, file identity, disk content, figure file creation.
- **Obsolete shapes:** None.

---

## Summary

| Disposition | Count |
|---|---|
| tauri-proof | 18 |
| browser-smoke | 1 |
| pending-removal | 0 |

All 19 specs have been read end-to-end. Zero specs contain obsolete Express/MIME/tikzjax/central-figures/route-interception proof shapes.
The sole browser-smoke file (`app.spec.ts`) is explicitly gated to the `browser-smoke` project and is the only file with IPC mocks.
`tikz-filter.spec.ts` correctly asserts against in-browser tikzjax as a negative proof.
`mime-types.spec.ts` is misnamed — content tests asset loading, not MIME types — recommended rename to `asset-loading.spec.ts`.
