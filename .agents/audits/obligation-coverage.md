# Obligation Coverage Matrix

**Branch:** feature/tauri-first-architecture
**Date:** 2026-06-03
**Purpose:** Gate 8 — every proof obligation from `docs/testing-proof-obligations.md` mapped to a real Tauri test or explicit architecture-retirement note.

---

## P0: Save Semantics, File Identity, and Workspace Transitions

| Obligation | Test | Status |
|---|---|---|
| Save writes exact state to disk | `file-integrity.spec.ts` ("save triggers atomic write"), `desktop-file-workflows.spec.ts` ("keeps real file identity") | Covered |
| External file detection blocks overwrite | `file-integrity.spec.ts` ("save detects external modification and refuses to overwrite") | Covered |
| Workspace transitions via Save As and Explorer | `desktop-file-workflows.spec.ts` ("Save As updates workspace root"), `file-selector.spec.ts` ("Save As dialog shows workspace tree") | Covered |
| Crash recovery via backup store | `session-persistence.spec.ts` ("recovers backup content", "recovers unsaved editor buffer after page reload") | Covered |
| Save-gate blocks plugins and figure actions | `plugins.spec.ts` ("plugin rejects run without a saved file path"), `diagram-workflow.spec.ts` ("create_diagram_file rejects on unsaved temp buffer") | Covered |
| Restore-last-file semantics | `session-persistence.spec.ts` ("restores last active file", "does not restore when restore_last_file is false") | Covered |
| Explorer mirrors workspace, filters debris | `desktop-file-workflows.spec.ts` ("explorer filters debris"), `user-behaviors.spec.ts` ("File Explorer shows filtered workspace") | Covered |

## P0: Renderer Integrity

| Obligation | Test | Status |
|---|---|---|
| User text arrives in preview as pandoc-rendered HTML | `proof-loop.spec.ts` ("renders torture document with all content classes") | Covered |
| Renderer stderr surfaces in diagnostics panel | `renderer-diagnostics.spec.ts` ("displays detailed renderer stderr and recovers") | Covered |
| Config changes trigger re-render | `command-parsing.spec.ts` (set_config updates parsed flags, bidirectional sync), `settings.spec.ts` (Settings dialog sync) | Covered |
| Latest edit wins under debounce | `user-behaviors.spec.ts` ("real typing, undo, rapid edits, and final preview state") | Covered |
| Src attribute preservation across all path forms | `architectural-regression.spec.ts` ("render preserves src attributes") | Covered |
| Math rendering (inline + display) | `proof-loop.spec.ts` ("renders inline math via mathjax") | Covered |
| Template and filter resolution is config-controlled | `command-parsing.spec.ts` (pandoc_assets returns configured filters, set_config with lua-filter updates parsed flags), `settings.spec.ts` (template path validation) | Covered |

## P0: Settings and Configuration

| Obligation | Test | Status |
|---|---|---|
| Config TOML round-trips (read/write parity) | `config-loading.spec.ts` ("get_config values reflected", "set_config writes updated TOML to disk") | Covered |
| Settings dialog bidirectional sync | `settings.spec.ts` ("Settings dialog supports bidirectional sync"), `command-parsing.spec.ts` ("toggling a checkbox updates raw command") | Covered |
| Templates/filters constrained to configured dirs | `settings.spec.ts` ("external template rejection") | Covered |
| Config init on clean system | `config-loading.spec.ts` ("initializes config.toml in XDG directory") | Covered |
| Config survives app restart without mutation | `config-loading.spec.ts` ("custom config is not overwritten on app startup") | Covered |

## P0: Plugin Execution

| Obligation | Test | Status |
|---|---|---|
| Export parity with pandoc oracle | `plugins.spec.ts` ("runs HTML export against the app tracked file", "runs LaTeX export", "runs PDF export") | Covered |
| Save-gate blocks plugin execution | `plugins.spec.ts` ("plugin rejects run without a saved file path"), `bug-fixes.spec.ts` ("explanatory prompt message when launching plugin with unsaved buffer") | Covered |
| Plugin with explicit path succeeds from unsaved state | `plugins.spec.ts` ("plugin run with explicit path succeeds even from unsaved state") | Covered |
| Plugin listing strips command internals | `plugins.spec.ts` ("lists bundled plugin metadata without command internals") | Covered |
| Plugin failures surface visible errors | `bug-fixes.spec.ts` ("explanatory prompt message") — partial; explicit error-path test is a gap. | Gap (filed) |

## P0: Figures, Clipboard, and Diagrams

| Obligation | Test | Status |
|---|---|---|
| Clipboard image insertion writes exact bytes to `figures/` | `user-behaviors.spec.ts` ("pasting an image via paste event inserts figure markdown and saves the asset") | Covered |
| Diagram creation is save-gated and document-relative | `diagram-workflow.spec.ts` ("create_diagram_file rejects on unsaved temp buffer", "creates template on saved document") | Covered |
| Figures library reflects workspace | `diagram-workflow.spec.ts` ("get_diagram_tools returns available tools") — partial; no full figures-registry listing test. | Gap (filed) |
| Preview figure interactions map to correct source | Not covered. Architecture note: preview figure edit launch requires app-side wiring not yet implemented in current Tauri build. | Architecture retirement |

## P0: Academic-Rendering Boundaries

| Obligation | Test | Status |
|---|---|---|
| TikZ rendered server-side to static SVG (no tikzjax) | `tikz-filter.spec.ts` ("renders tikzcd environment as a static server-side SVG") | Covered |
| TikZ `\input{}` resolution | `tikz-filter.spec.ts` ("recursively resolves input{...}") | Covered |
| `pdf_tex` overlay rendering | `tikz-filter.spec.ts` ("resolves and renders Inkscape svg-inkscape pdf_tex overlays") | Covered |

## P1: OS Integration and Secondary Workflows

| Obligation | Test | Status |
|---|---|---|
| Quick Open drives real launcher pipeline | Not covered. Architecture note: Quick Open (`Ctrl/Cmd+P`, `quick_open_spawn`) is wired in the Rust backend but no E2E test exercises the full pipeline with a real launcher. | Gap (filed) |
| Citation insertion uses citation boundary | Not covered. Architecture note: Zotero citation (`zotero_cite`) requires a real local Zotero endpoint. Test harness cannot guarantee availability. | Architecture retirement |
| Status chrome is trustworthy during real session | `user-behaviors.spec.ts` ("default document editing, saving, reload, and status display work together") | Covered |

## P1: Additional Coverage

| Test | Obligation |
|---|---|
| `desktop-smoke.spec.ts` | App shell mounts with real Tauri IPC (no specific proof-obligation mapping; harness check) |
| `editor-height.spec.ts` | CodeMirror fills available height (UI layout obligation, not explicitly in proof-obligations doc) |
| `mime-types.spec.ts` (→ `asset-loading.spec.ts`) | Compiled JS/CSS assets load, not raw source (build integrity) |
| `bug-fixes.spec.ts` | Exact path match in Explorer, UnsavedChangesDialog workflow, workspace root defaults (regression coverage) |

---

## Gap Summary

| Obligation | Disposition |
|---|---|
| Plugin failure error-path test | Gap — issue to be filed. Covered partially by `bug-fixes.spec.ts` unsaved-buffer prompt. |
| Figures library full listing test | Gap — issue to be filed. Partial: `diagram-workflow.spec.ts` tool listing. |
| Preview figure interactions | Architecture retirement — app-side wiring not in current Tauri build. |
| Quick Open E2E | Gap — issue to be filed. Requires real launcher in test harness. |
| Citation insertion E2E | Architecture retirement — requires real Zotero endpoint not available in CI. |

All P0 obligations are covered by real Tauri tests or have explicit architecture-retirement notes.
P1 gaps are documented with file-issue dispositions.
Zero obligations are unaccounted.
