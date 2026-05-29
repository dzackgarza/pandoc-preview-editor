---
title: pandoc-preview design constraints
tags: [design, philosophy, pandoc-preview]
---

# pandoc-preview Design Constraints

## Render Command Is a Black-Box One-Liner

The pandoc render command is defined as a single copy-pastable shell string in
`pandoc-preview.toml` under `[pandoc] render_command`. The app treats this string as
an opaque command: split it into argv via `shell-quote`, pipe text in, read HTML out.
No app logic may interpret the renderer's semantics beyond this.

The app's job is to help the user *remember and manage* the current command string,
not to understand what it does.

## Flag Validation Is Intentional and Correct

The Settings UI exposes known Pandoc flag names (standalone, citeproc, math engine,
etc.) as a GUI. Pandoc's flag vocabulary has been stable for a decade. Validating
against known flags and loudly rejecting unknown ones is the stated happy path.
This is not a violation of the black-box contract — it is a lightweight frontend aid
that reduces errors and helps the user remember current settings.

Do NOT mistake this flag-awareness for "renderer introspection". The flags are
well-known constants, not dynamically derived from the renderer. The validation is
client-side UX scaffolding on top of an otherwise opaque command string.

## Shell Expansion Belongs to the Shell, Not the App

The app must NEVER implement its own tilde (`~/`) expansion, environment variable
substitution, glob expansion, or any other shell-layer operation. These are owned by
the OS shell. The correct fix is to invoke the renderer with `shell: true` in
`node:child_process.spawn`, which delegates all shell expansion to the system shell.
Any bespoke `expandTildePaths` function is a design error: it is the app
reinventing shell semantics it does not own and cannot get fully right.

**POSIX nuance**: POSIX sh does NOT expand `~` after `=` in command arguments
(e.g. `--lua-filter=~/.pandoc/foo`). To handle this, render.ts normalizes
`~/` → `$HOME/` in the raw command string before spawning. This is a notation
normalization (one regex replace), not bespoke path expansion — the shell still
does the actual `$HOME` resolution. This keeps the `expandTildePaths` argv-walker
out of the codebase while handling the common `--flag=~/...` pattern.


## `~/.pandoc/` Enforcement Is Load-Bearing

Templates must live in `~/.pandoc/templates/` and filters in `~/.pandoc/filters/`.
The server's validation that `--template` and `--lua-filter`/`--filter` paths resolve
inside those directories is **correct and intentional**. It enforces filesystem hygiene
and organization: users are forced into a workflow where all assets are centralized and
discoverable. Do NOT treat this as "the app introspecting renderer internals" — it is
the app enforcing its own workspace contract. Never remove or soften this validation.

## Dependency Inversion Rule

Any functionality a mature dependency already provides must be delegated to that
dependency. Writing bespoke helpers for: shell parsing, tilde expansion, TOML
serialization, path validation, HTML sanitization — is a design error. Use the
dependency; own only the orchestration.

## Local Desktop Trust Model

The application runs locally on the user's desktop/machine. The user is the administrator and owner of the rendering pipeline. The trust model assumes complete user ownership over command execution.

Therefore:
- Security policies designed for multi-tenant, public-facing web applications (such as strictly sandboxing shell commands or disabling shell execution via `shell: false`) do not apply and would actively degrade standard shell-layer features.
- Running the renderer via a standard shell using `shell: true` is correct and necessary to allow the user to use native shell features (pipes, environment variable interpolation, system-level paths).
- The focus of safety is strictly on **local file integrity** (preventing corruption via atomic writes and avoiding silent overwrites through external modification conflict checking), not sandboxing user-configured commands.

## Local Companion Desktop Server Philosophy (Spawning dmenu/rofi, Drawing Tools)

The application runs locally as a companion process on the user's desktop machine, not as a remote, headless cloud server. The helper server is a local process that has full, intentional access to the user's active graphical session (X11/Wayland), display servers, and system-native CLI utilities.

Therefore:
- **No Boundary Violations for OS Tools:** Spawning system-native CLI or desktop GUI utilities (`rofi`, `dmenu`, `fzf`, or drawing tools like `inkscape` or `xournalpp`) directly from the server is the **correct, expected, and first-class design choice** for deep system integration.
- **Dependency Aversion & OS Integration:** Do NOT attempt to reinvent complex interface modals (such as file-finding, workspace scanning, fuzzy matching, or graphic drawing) inside the browser client or server-side Javascript code. Spawning pre-existing, native OS tools keeps the codebase extremely lightweight and integrates seamlessly with the user's existing desktop workflows.
- **Headless Assumptions Do Not Apply:** Flagging host GUI/X11 process spawning as an "error" or a "boundary violation" is a fundamental misunderstanding of the application's local companion architecture. The application is, by design, a companion to your local terminal and desktop environment.

