# REQUIREMENTS.md

## 0. Authority and freeze status

This document is the normative product and architecture requirements authority. The existing implementation, tests, branches, PRs, TODOs, and docs are evidence only. No current behavior, dependency, component, endpoint, file layout, test, or branch direction is inherited unless this document states the requirement it satisfies.

**Freeze Status**: **IN EFFECT** (as of 2026-06-05)
**Scope**: All product-changing work is blocked. Allowed work: extraction, inspection, and critical data-loss/security fixes.

## 1. Product definition

**pandoc-preview** is a local-first, academic-focused plain text editor with a live integrated preview. It is designed for researchers who author documents using Pandoc and TikZ, and who require high levels of academic reproducibility and deep system integration.

- **Outcome**: The user authors text in a familiar environment and sees a live, faithfully rendered representation of the final document.
- **Audience**: Academic researchers, mathematicians, and technical writers.
- **System Type**: A local desktop companion application that integrates with the host operating system, filesystem, and version control.

## 3. User-facing requirements

### REQ-001: Live Preview

Outcome: The user sees a rendered version of the current editor text that updates as they type.
User-visible behavior: A preview pane displays the output of the configured renderer.
Inputs: Textarea content, project configuration.
Outputs: Rendered document (e.g., HTML).
State read: bufferContent, renderCommand.
State written: previewContent, renderStatus.
Owner: App/Server.
Failure behavior: Visible error message with stderr details if render fails.
Acceptance oracle: Typing "Hello" in the editor results in "Hello" (possibly with styling) appearing in the preview.

### REQ-002: Atomic Save with Git Commit

Outcome: The current editor buffer is persisted to disk and committed to a version control system.
User-visible behavior: Saving the document creates a permanent record in the file's history.
Inputs: Textarea content, file path.
Outputs: Updated file on disk, new git commit.
State read: bufferContent, currentFilePath, gitTrackingStatus.
State written: diskContent, gitHistory.
Owner: App/Server.
Failure behavior: Halt and report if save or commit fails. Loud failure on conflicts.
Acceptance oracle: Saving a tracked file creates exactly one git commit containing the new content.

### REQ-003: Academic Reproducibility (Centralized Assets)

Outcome: Document rendering is reproducible across machines using the same dotfiles.
User-visible behavior: Templates and filters are loaded from a central directory, not ad-hoc project paths.
Inputs: Command flags, asset directory paths.
Outputs: Resolver-verified paths for Pandoc assets.
Owner: App/Server (Enforcement).
Failure behavior: Refuse to use assets outside the authorized directories.
Acceptance oracle: Renderer command fails if it references a template outside the centralized asset directory.

### REQ-004: Server-side TikZ/Diagram Rendering

Outcome: Complex diagrams are rendered faithfully and reproducibly.
User-visible behavior: TikZ code blocks are converted to images (SVG) and displayed in the preview.
Owner: App/Server (via External Renderer).
Failure behavior: Show render error if diagram compilation fails.
Acceptance oracle: A TikZ block in the editor appears as a vector graphic in the preview, rendered identically to a standalone compilation.

## 4. Ownership model

| Capability | Owner | Non-owners | Rule |
|---|---|---|---|
| Document Text | Editor Textarea | Backend, Filesystem | The textarea is the canonical document source. |
| File Identity | App/Server | External Editor, Firenvim | The app tracks path and workspace association. |
| Rendering Semantics | External Renderer | App Code, Javascript | The app only coordinates the render pipeline. |
| Editor Mechanics | External Editor (nvim) | React Code | The app provides the container, the editor provides the behavior. |
| Persistence (Recovery) | Git | App-owned backups | Git history is the crash recovery layer. |

## 5. State model

- **currentDocument**: `none | unsavedBuffer | savedFile(path)`
- **bufferStatus**: `clean | dirty`
- **renderStatus**: `idle | rendering | rendered | failed`
- **workspace**: `unset | root(path)`
- **configuration**: `valid | invalid`

## 9. User-Surprise and Forbidden Behavior Inventory

If the app cannot perform the requested product action under the current declared requirements, it must fail loudly and visibly at the relevant boundary.

| Forbidden behavior | Why it surprises the user | Required product stance | Related state/owner |
|---|---|---|---|
| Silent config fallback | The user's intended settings are ignored without notice. | Hard failure | configuration |
| Hidden render failure | The preview remains stale while the user thinks it updated. | Hard failure (show stderr) | renderStatus |
| Best-effort save | Data might be lost or written to the wrong location. | Hard failure | currentDocument |
| Temporary file as identity | Plugins or exports run against the wrong path. | Forbid action | currentDocument |
| Suppressed stderr | Diagnostics needed to fix the document are hidden. | Hard failure | App/Server |
| Warning-only conflict | Concurrent edits are overwritten silently. | Refuse action | bufferStatus |

## 10. Abstract Product State Machine

- **State machine**: Document Lifecycle
- **State variables**: `currentDocument`, `bufferStatus`, `renderStatus`
- **Transitions**:
  - `Edit`: `bufferStatus` clean -> dirty
  - `Render`: `renderStatus` idle -> rendering -> rendered | failed
  - `Save`: `bufferStatus` dirty -> clean, `currentDocument` updated

## 11. Happy Paths and Expected User Stories

## 12. Anti-requirements

- **ANTI-001**: No in-browser renderer. Rendering MUST happen on the server/host.
- **ANTI-002**: No manual backup files as save targets.
- **ANTI-003**: No suppression of non-zero exit codes from Pandoc or other tools.

## 13. Open decisions

- **DEC-001**: Remote editing. Should the app support non-local document roots? (Current stance: No).

## 14. Acceptance oracles

- **ORACLE-001**: "The Preview is Truth." Given editor text X, the preview iframe `body.innerHTML` must match the output of `render_command(X)`.

## 15. Maintenance rule

Any change that adds, removes, or changes user-facing behavior, state ownership, external contracts, failure behavior, or architectural boundaries must update this document before or in the same change. Product-semantic code changes without a requirements-authority update are invalid.
