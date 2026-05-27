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
