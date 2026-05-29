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

## Local Filesystem Autosave & Recovery Philosophy (The Anti-Sandbox Rule)

For a plain text editor, losing ephemeral editing state (unsaved buffers, draft text) is catastrophic. The application must treat the host filesystem as the Single Source of Truth (OSOT) for all backup, autosave, and recovery mechanisms.

Therefore:
- **No Browser Sandbox Traps (`localStorage`):** Do NOT store unsaved backups or editor drafts in browser-native storage (`localStorage`, `sessionStorage`, `IndexedDB`). Browser storage is sandboxed, volatile (cleared on incognito, profile resets, cache wipes), and completely invisible to host processes (like Firenvim, Neovim, CLI tools, or server recovery scripts).
- **Host-Bound Backup Files:** The client must continuously synchronize its unsaved buffers to the local host filesystem via the companion server (e.g. debounced loopback `/api/backup` HTTP POSTs writing to `/tmp` or `.local/state`). This is the only way to ensure backups are durable, portable, and accessible across multiple editing clients (browser, Firenvim, Neovim, terminal).
- **Loopback & Page Cache Efficiency:** Do NOT mistake frequent localhost backup requests for "network overhead" or "disk thrashing". Loopback packets (`127.0.0.1`) are handled entirely in memory by the OS kernel with near-zero CPU cost. Furthermore, small debounced writes to `/tmp` are optimized by the OS page cache (or RAM-backed `tmpfs`), ensuring physical disk wear and event-loop blocks are completely negligible.
- **Durable Swap Recovery:** The local backup system is functionally equivalent to native Neovim swap (`.swp`) files. Upon server startup, the backend must be able to scan the host disk backup folder to automatically restore the last active unsaved session.

## Fixed TeX & Diagram Compiling Philosophy (No Dynamic Lua Template Hacking)

For the compilation of drawings or standalone TeX/TikZ blocks into graphic assets (SVG, PNG), the compiler wrapper must compile content against a static, fixed literal template file on disk.

Therefore:
- **No Dynamic Template Construction:** Do NOT construct dynamic LaTeX templates as strings inside Lua filters or dynamically manipulate template strings in Javascript/Lua. Do not generate ad-hoc templates in the filter.
- **Fixed Literal Files:** Keep a static template file (e.g., `templates/tikz-template.tex` or globally in `~/.pandoc/templates`) containing all required macros, packages, and custom page definitions.
- **One Job for the Filter/Runner:** The Lua filter or drawing runner has exactly one job: extract the LaTeX/TikZ code block, write it into a designated slot in a copy of the fixed template, compile it using standard CLI tools (e.g., `pdflatex`, `lualatex`, `pdf2svg`), and return the generated graphic asset. This keeps the filter simple (merely managing a clean compilation pipeline) rather than reinventing a static-site generator or templating engine.

## Standard Pandoc AST Link Resolution (No Brittle Regex String Rewriting)

When parsing and rendering custom links (such as Obsidian-style wikilinks `[[Link]]` or `[[Link|Label]]`), the app must utilize Pandoc's native AST parser representation instead of custom regex string accumulators.

Therefore:
- **No Fragile String Rewriters:** Avoid hand-rolling multi-hundred-line regex search-and-replace blocks inside Lua filters to parse nested brackets, markdown text, or HTML links.
- **Native AST Processing:** Pandoc natively parses wikilink constructs when the standard extension is enabled. Process these cleanly via direct AST node manipulation in a standard Lua filter of less than 10 lines. By operating directly on `Link` and `Str` AST nodes, we guarantee syntax-safe updates that never break or mangle surrounding document elements.

## Startup-Time Tool Discovery & Fail-Fast Architecture

The helper server must determine available CLI/GUI tools once during startup rather than scanning host environments on every incoming user action.

Therefore:
- **Discover Once at Startup:** Probe system executable paths (`qtikz`, `tikzit`, `inkscape`, `xournalpp`, `dmenu`, `rofi`, etc.) exactly once during server startup (e.g., in `createApp`).
- **Cache and Expose via API:** Cache this availability state and expose it via a clean endpoint (`GET /api/diagram/tools`).
- **Gray Out Unavailable Options:** The frontend client must use this cached state to disable, gray out, or remove buttons for tools not installed on the user's host system, providing immediate visual feedback.
- **Fail-Fast Endpoint Validation:** The server's launch endpoint (`POST /api/diagram/launch`) must assert tool availability and fail-fast with a 400 Bad Request error if a missing tool is requested, completely avoiding defensive shell/process spawning error recovery during runtime.

## Standard Preview Asset Resolution via `<base href>`

To resolve document-relative and absolute asset URLs (e.g. images, figures) inside the preview iframe, use the standard browser-native `<base href>` element combined with Express static asset directories.

Therefore:
- **Delete Brittle HTML Rewriters:** Do NOT use hand-rolled regex engines to parse HTML strings, extract tags, and rewrite source URLs before returning them to the iframe.
- **Absolute Host Base Injection:** Because sandboxed `srcdoc` iframes default their base URL to `about:srcdoc` (rendering relative base hrefs non-functional), the server must dynamically inject a fully qualified absolute URL (e.g. `http://localhost:port/api/preview-assets/`) based on the incoming request's host header.
- **Secure Static Serving:** Mount the `/api/preview-assets/` endpoint to the document root (`express.static(currentDocumentRoot(config))`). To prevent relative path resolution failures, strip any leading slashes cleanly from the request path before matching absolute paths securely within the workspace.
