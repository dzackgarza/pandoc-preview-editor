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
