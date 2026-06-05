# REQUIREMENTS.md

## 0. Authority and freeze status

This document is the normative product and architecture requirements authority. The existing implementation, tests, branches, PRs, TODOs, and docs are evidence only. No current behavior, dependency, component, endpoint, file layout, test, or branch direction is inherited unless this document states the requirement it satisfies.

**Freeze Status**: **IN EFFECT** (as of 2026-06-05)
**Scope**: All product-changing work is blocked. Allowed work: extraction, inspection, and critical data-loss/security fixes.

## 1. Product definition

**pandoc-preview** is a local-only, academic-focused plain text editor with a live integrated preview. It is designed for researchers who author documents using Pandoc and TikZ, and who require high levels of academic reproducibility and deep system integration.

- **Local-Only Boundary**: The app does not support remote editing (SSH, S3, etc.). Remote access is delegated entirely to the host filesystem. The app assumes local file access.
- **Outcome**: The user authors text in a familiar environment and sees a live, faithfully rendered representation of the final document.
- **Audience**: Academic researchers, mathematicians, and technical writers.
- **System Type**: A local desktop companion application that integrates with the host operating system, filesystem, and version control.

## 2. Non-goals

- **Remote Editing Support**: No attempt is made to overtly support remote filesystems.
- **In-browser rendering logic**: The app does not own the semantic transformation of text to document formats (delegated to external renderer).
- **Text editing mechanics**: The app does not own modal editing, motions, or text-object logic (delegated to external editor).
- **Project management/Task tracking**: The app is an editor/previewer, not a project management suite.
- **Multi-platform consistency at the cost of integration**: The app prioritizes deep integration with the user's host OS (X11/Wayland/Linux) over providing a "web-like" uniform experience across platforms.

## 3. User-facing requirements

### REQ-001: Live Preview

Outcome: The user sees a rendered version of the current editor text that updates as they type.
User-visible behavior: A preview pane displays the output of the configured renderer.
Inputs: Textarea content, project configuration.
Outputs: Rendered document (e.g., HTML).
State read: bufferContent, renderCommand.
State written: previewContent, renderStatus.
Owner: App/Server.
Failure behavior: **Non-fatal failure**. If the renderer (Pandoc/LaTeX) fails, the app surfaces the raw error dump in a scrollable log (similar to Overleaf) within the preview pane.
Acceptance oracle: Typing "Hello" in the editor results in "Hello" (possibly with styling) appearing in the preview.

### REQ-002: Git-Native Persistence (Save-as-Commit)

Outcome: The current editor buffer is persisted to disk and committed to git as a single atomic operation.
User-visible behavior: Saving the document creates a permanent record in the file's history.
Inputs: Textarea content, file path.
Outputs: Updated file on disk, new git commit.
State read: bufferContent, currentFilePath, gitStatus.
State written: diskContent, gitHistory.
Owner: App/Server.
Happy Path Guidance: The UI prominently warns when a file is not in a repo or is untracked. It provides direct actions to `git init` the workspace and `git add` the file. 
Failure behavior: If the save/commit operation fails, the app must report it loudly.
Acceptance oracle: In a tracked repo, clicking "Save" creates exactly one git commit with the current buffer text.

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
External Tool Contract: The app cements and enforces exact contracts with external tools (e.g., quiverapp). It always tracks the current version of these tools and **breaks loudly** if the tool updates in a way that violates the contract.
Failure behavior: Show render error log if diagram compilation fails.
Acceptance oracle: A TikZ block in the editor appears as a vector graphic in the preview, rendered identically to a standalone compilation.

### REQ-005: Local Tool Integration (Companion Mode)

Outcome: Deep integration with the user's desktop environment and preferred tools.
User-visible behavior: The app can launch local tools (e.g., drawing apps, fuzzy finders) to assist in document creation.
Owner: App/Server.
Failure behavior: Visible error if a requested tool is missing or fails to launch.
Acceptance oracle: Invoking a "Drawing" command launches a configured local drawing tool.

## 4. Ownership model

| Capability | Owner | Non-owners | Rule |
|---|---|---|---|
| Document Text | Editor Textarea | Backend, Filesystem | The textarea is the canonical document source. |
| File Identity | App/Server | External Editor, Firenvim | The app tracks path and workspace association. |
| Rendering Semantics | External Renderer | App Code, Javascript | The app only coordinates the render pipeline. |
| Editor Mechanics | External Editor (nvim) | React Code | The app provides the container, the editor provides the behavior. |
| Persistence (Recovery) | Git | App-owned backups | Git history is the primary crash recovery layer. |

## 5. State model

- **currentDocument**: `none | unsavedBuffer | savedFile(path)`
- **bufferStatus**: `clean | dirty`
- **renderStatus**: `idle | rendering | rendered | failed(log)`
- **gitStatus**: `noRepo | untracked | trackedDirty | trackedClean`
- **workspace**: `unset | root(path)`
- **configuration**: `valid | invalid`

## 6. External contracts

- **Pandoc**: Primary document renderer. Expects text in, returns HTML out. Non-fatal failure (surface logs).
- **Git**: Primary persistence substrate. Commit + Save are tied.
- **TikZ Tools (quiver, freetikz)**: Deeply integrated generation tools. The app tracks the **current** version and breaks loudly on contract violations.
- **Shell**: Command execution environment. Used for rendering and launching tools.
- **Tauri**: Local system IPC and desktop-app substrate.

## 8. Failure semantics

- **App Logic Failures**: The app must **crash loudly** on internal logic bugs. The recovery model (Git-native autosaves) ensures work is robust to crashes.
- **Rendering Failures**: **Non-fatal**. Errors from Pandoc/LaTeX/TikZ must be captured and surfaced in a dedicated, scrollable error log within the preview pane.
- **Plugin Failures**: Surfaced via Toast notifications and logged to the in-app error log. Plugins are user-owned; debugged externally.
- **External Tool Failures**: If an integrated tool (e.g. `quiver`) changes its output format, the app must **fail loudly and immediately** at the extraction boundary.

## 9. User-Surprise and Forbidden Behavior Inventory

If the app cannot perform the requested product action under the current declared requirements, it must fail loudly and visibly at the relevant boundary.

| Forbidden behavior | Why it surprises the user | Required product stance | Related state/owner |
|---|---|---|---|
| Silent config fallback | The user's intended settings are ignored without notice. | Hard failure | configuration |
| Hidden render failure | The preview remains stale while the user thinks it updated. | Hard failure (show log) | renderStatus |
| Best-effort save | Data might be lost or written to the wrong location. | Hard failure | currentDocument |
| Temporary file as identity | Plugins or exports run against the wrong path. | Forbid action | currentDocument |
| Suppressed stderr | Diagnostics needed to fix the document are hidden. | Hard failure | App/Server |
| Warning-only conflict | Concurrent edits are overwritten silently. | Refuse action | bufferStatus |
| Version pinning for TikZ | Forces user to use stale tools; hides integration drift. | Break loudly on update | External Tools |

## 10. Abstract Product State Machine

- **State machine**: Document Lifecycle
- **State variables**: `currentDocument`, `bufferStatus`, `renderStatus`, `gitStatus`
- **Transitions**:
  - `Edit`: `bufferStatus` clean -> dirty
  - `Render`: `renderStatus` idle -> rendering -> rendered | failed(log)
  - `Save`: `bufferStatus` dirty -> clean, `currentDocument` updated. If `gitStatus` != `noRepo`, also `commit`.
  - `GitInit/Add`: `noRepo` -> `untracked` -> `trackedClean`

## 11. Happy Paths and Expected User Stories

### Story: Author and Save

**User intent**: Create a new document, write content, and save it to disk.
**Initial state**: `currentDocument = none`, `bufferStatus = clean`, `gitStatus = noRepo`
**Steps**:
1. User types text. -> `bufferStatus = dirty`
2. App renders. -> `renderStatus = rendered`
3. User saves and chooses `/tmp/test.md`. -> `currentDocument = savedFile('/tmp/test.md')`, `bufferStatus = clean`
4. App warns about `noRepo`. User clicks `git init`. -> `gitStatus = untracked`
5. User clicks `git add`. -> `gitStatus = trackedClean`

**Acceptance oracle**: The file `/tmp/test.md` contains the editor text and the app displays the path and git status.

## 12. Anti-requirements

- **ANTI-001**: No in-browser renderer. Rendering MUST happen on the server/host.
- **ANTI-002**: No manual backup files as save targets.
- **ANTI-003**: No suppression of non-zero exit codes from Pandoc or other tools.
- **ANTI-004**: No version pinning for external TikZ tools.

## 13. Open decisions

- **DEC-001**: Remote editing. Should the app support non-local document roots? **STANCE: NO**. Delegate to host OS/filesystem.

## 14. Acceptance oracles

- **ORACLE-001**: "The Preview is Truth." Given editor text X, the preview iframe `body.innerHTML` must match the output of `render_command(X)`.

## 15. Maintenance rule

Any change that adds, removes, or changes user-facing behavior, state ownership, external contracts, failure behavior, or architectural boundaries must update this document before or in the same change. Product-semantic code changes without a requirements-authority update are invalid.
