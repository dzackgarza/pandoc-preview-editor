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

The app targets academic writing where paper compilations must remain reproducible across
years, machines, and institutions. This drives several design decisions that may appear
restrictive:

- **Centralized Pandoc assets**: Templates, filters, macros, and CSL files must live under
  `~/.pandoc/`, version-controlled like dotfiles. A researcher moving to a new institution
  or replacing a machine can clone their pandoc dotfiles repo and have papers compile
  identically. The app enforces this centralization as a hard rule: the structured UI
  resolves template and filter flags exclusively through the configured `templates_dir`
  and `filters_dir`, and deliberately prevents attaching filters or templates from
  arbitrary filesystem locations. The raw command tab bypasses this enforcement but is
  not the advertised workflow.

- **Command string as SSOT**: The `render_command` config field stores the full invocation
  as a single portable string. The canonical workflow is: develop and verify a Pandoc
  command in the terminal first, then paste it into the app config. The app consumes the
  working command and provides a live preview immediately. The same string can feed CI
  scripts or a teammate's config without transformation. For ongoing work, the structured
  UI lets users tweak their long-running preferred Pandoc invocation — toggling filters,
  switching templates, adjusting flags — without editing the raw string by hand each
  time.

- **Convenience layer does not own flags**: The structured Settings controls parse the
  command string for display and reconstruct it on save. They never write independent flag
  fields to config. This keeps the config file renderer-agnostic — nothing in the schema
  references pandoc-specific flags — while providing inline access to common options,
  template browsing, and filter toggling. The UI exists to help users *manage the unruly
  string* and discover available flags without consulting the Pandoc manpage for every
  option, not to replace terminal-based command development.

- **Raw command escape hatch**: Users with non-standard setups (custom filter locations,
  uncommon flag combinations, chained wrappers) always have the raw text tab. The
  structured UI is a convenience, not a gate. The app does not canonicalize paths in the
  raw string.
