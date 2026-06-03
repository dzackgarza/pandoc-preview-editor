---
status: active
tags:
- pandoc-preview
- feature-evaluation
- design-philosophy
---

# Feature Evaluation Philosophy

Evaluate each feature against the current shipped model:

- The default app is a browser-based plain text editor with live Pandoc preview.
- Firenvim may take over the editor textarea, but it only syncs text with that textarea.
- The app owns file-system interaction: opening files, creating files, saving textarea content to disk, listing the workspace, and passing file paths to server-side tools.
- Nvim remains relevant for editing behavior inside the textarea, not for app file ownership or server state.

## How to Apply

- **Delete obviated feature cards from active plans.** If Firenvim, nvim, the textarea, or Pandoc already handles the full user outcome, the app does not need that feature. Do not preserve it as a candidate, and do not reframe it as nearby app work.
- **Define the feature by user outcome, not by GUI widget.** "The user saves the current document to disk" belongs to the app because Firenvim does not connect the textarea to a project file.
- **Use nvim research only for editor behavior.** Motions, text objects, completion, snippets, and buffer-local editing affordances can be delegated to Firenvim/nvim. File open/save, workspace browsing, render timing, renderer invocation, and external command execution are app concerns. Renderer-specific arguments belong in config or wrapper commands.
- **Avoid parallel ownership.** The canonical document text is the textarea value. Save, render, export, and plugin actions must read that value or the currently selected file tracked by the app.
- **Research before claiming.** "Can This Already Be Done?" sections require actual evidence. Do not use old nvim/TCP assumptions as evidence for the Firenvim app.
- **OS Integration & Familiar Tooling.** Since the server runs locally on the user's desktop, the app should tightly integrate with the operating system and utilize familiar, native CLI utilities. Offload complex interface workflows to existing local tools instead of reinventing them inside the browser. For instance, spawning desktop tools like `dmenu`, `fzf`, or system command utilities is the expected design choice for deep system integration rather than reinventing a file indexer or search modal in React/Node.

## Academic Reproducibility Rationale

The app targets academic writing where paper compilations must remain reproducible across years, machines, and institutions. This drives several design decisions that may appear restrictive:

- **Centralized Pandoc assets**: Templates, filters, macros, and CSL files must live under `~/.pandoc/`, version-controlled like dotfiles. A researcher moving to a new institution or replacing a machine can clone their pandoc dotfiles repo and have papers compile identically. The app enforces this centralization as a hard rule: the structured UI resolves template and filter flags exclusively through the configured `templates_dir` and `filters_dir`, and deliberately prevents attaching filters or templates from arbitrary filesystem locations. The raw command tab bypasses this enforcement but is not the advertised workflow.
- **Command string as SSOT**: The `render_command` config field stores the full invocation as a single portable string. The canonical workflow is: develop and verify a Pandoc command in the terminal first, then paste it into the app config. The app consumes the working command and provides a live preview immediately. The same string can feed CI scripts or a teammate's config without transformation. For ongoing work, the structured UI lets users tweak their long-running preferred Pandoc invocation — toggling filters, switching templates, adjusting flags — without editing the raw string by hand each time.
- **Convenience layer does not own flags**: The structured Settings controls parse the command string for display and reconstruct it on save. They never write independent flag fields to config. This keeps the config file renderer-agnostic — nothing in the schema references pandoc-specific flags — while providing inline access to common options, template browsing, and filter toggling. The UI exists to help users *manage the unruly string* and discover available flags without consulting the Pandoc manpage for every option, not to replace terminal-based command development.
- **Raw command escape hatch**: Users with non-standard setups (custom filter locations, uncommon flag combinations, chained wrappers) always have the raw text tab. The structured UI is a convenience, not a gate. The app does not canonicalize paths in the raw string.
- **Templates are data, not code**: Pandoc templates, TikZ intermediates, macros, and style files are user-editable data stored under `~/.pandoc/` or the app's config directory. No app code may embed template content or construct templates through string manipulation. When a new macro package is released or a style needs updating, the user edits a file in their version-controlled dotfiles — no code change, no deployment blast radius. For TikZ rendering, the injection template lives under `~/.pandoc/` and is referenced from the render command like any other template.
- **TikZ rendered to SVG via Pandoc, never tikzjax**: TikZ diagrams are rendered to SVG through the Pandoc pipeline, never through an in-browser JavaScript engine. TikZjax lacks full TikZ feature coverage, does not support user macros, is outside the app's template control, and — most critically — produces output that is not reproducible outside the app. Server-side Pandoc → SVG rendering is externally auditable, handles text vs drawing scaling correctly, and compiles identically on any machine. The resulting SVG is embedded as an image in the preview output.

## Fail-Fast Architecture

Research-critical tooling cannot tolerate silent corruption. The app must crash immediately and visibly on any unexpected state or invariant violation.

- **No error swallowing**: Every exception representing unexpected state must be surfaced visibly to the user. Catching errors to log and continue, substituting fallback defaults, or silently retrying is prohibited — these patterns convert recoverable runtime errors into unrecoverable data corruption.
- **Assert invariants at every boundary**: Assumptions about data shape, system state, and renderer output must be enforced where they enter the system. A null file path, an unreadable config file, a renderer timeout, or a missing template must produce a hard user-visible failure, not a silent log entry.
- **Crash over corrupt**: A broken build, a stalled render, or a crashed subsystem is always less costly than silently incorrect output. Every suppression of an error signal for "user experience" reasons is a bet against the user's research data — the app cannot win that bet.
- **Instrument for agent triage**: Error output must contain enough information (stack trace, state snapshot, input context) for an automated agent to diagnose and harden the failing path without manual reproduction. Opaque "something went wrong" placeholders, partial error messages, and truncated failure codes are not acceptable.

## Git-Native Version Control

The app delegates versioning, crash recovery, and rollback to git rather than reinventing any of these mechanisms. This follows from the core value: the user's writing is gold and must be protected, recoverable, and roll-back-able with minimal app-specific machinery.

- **GUI signals VC state prominently**: The workspace chrome always displays whether the active file is tracked in a git repository (has been committed at least once). Untracked files — whether outside any repo or sitting in a repo but never committed — receive a visually prominent indicator (banner, color coding, status bar entry) so the risk surface is immediate and unmistakable. The absence of tracking is treated as an exceptional state worth highlighting. The prominent indicator is a call to action — the user is expected to track the file in git, not to tolerate the warning indefinitely.
- **Every save is a git commit** — both explicit user saves and automatic timer-driven autosaves. For a tracked file, saving and committing are the same operation: the file write IS a git commit. There is no two-step process. For an untracked file (not in git at all, or inside a repo but never committed) or an unsaved buffer, save and commit necessarily split because there is no tracking — the backend writes to its own recovery repo. This split is a transient condition flagged by the prominent untracked warning, not a normal dual-path workflow. Autosaves also create git commits on a short timer, keeping the crash-loss window to single-digit seconds regardless of where the autosave target lands.
- **Commits are cheap; squash is deferred**: On 2026 hardware, creating a commit per save is negligible in both time and storage. The resulting high-frequency history provides fine-grained rollback and crash recovery without any app-owned backup machinery. Agents can squash and clean history during maintenance — the app never gates a write on squash readiness.
- **Crash recovery delegated to git, not app code**: There is no app-owned backup format, no "autosave" system separate from git, no temporary-file snapshot scheme. The backend git repo is the crash recovery layer, period. The backend autosaves the current buffer on a short internal timer (sub-10-second debounce) and commits every autosave. A power outage or killed process loses at most a few seconds of work. The moment text enters the buffer it is continuously protected; there is no manual-save dependency for crash safety.
