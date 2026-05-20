# Feature: "Plugin" Dropdown Menu with TOML-Declared CLI Commands

## Problem

The app has a fixed pipeline (markdown in → pandoc → HTML out).
Users who want to extend behavior — export to PDF, run a custom post-processor, send the
file to a different tool — have no integration surface.
Adding these as hard-coded features doesn't scale.

## Can This Already Be Done?

Exporting to PDF/LaTeX/HTML can be done manually via pandoc on the command line.
The app does not need to provide export functionality.
What it needs is a *generic mechanism* for users to add custom commands that receive the
current file path and execute.

Existing nvim plugins like `vim-dispatch` or `toggleterm` can run shell commands inside
nvim, but they do not receive the app's tracked file path, do not surface in the browser
GUI, and do not provide a configuration format that app plugin authors can distribute.
This feature is about GUI discoverability of external tools.

**The plugin ecosystem is the goal.
The test plugins (Export to PDF/LaTeX/HTML) are proofs-of-concept — they verify the menu
system is configuration-driven and can dynamically run CLI apps with the file path
injected.**

## Proposed Solution

### Plugin Declaration Format (TOML)

Each plugin is a single TOML file.
Multiple TOML files are bundled into the app at build time.
Each file declares:

```toml
name = "Export to PDF"
description = "Convert the current markdown file to PDF using pandoc"
command = "pandoc \"${FILE}\" --from markdown --to pdf -o \"${FILE%.md}.pdf\""
category = "Export"
icon = "file-pdf"  # optional, for future icon support
```

### Special Variables Available to All Plugins

| Variable | Description | Example |
| --- | --- | --- |
| `${FILE}` | Full path to the currently edited file | `/home/user/doc.md` |
| `${FILE_DIR}` | Directory containing the file | `/home/user` |
| `${FILE_NAME}` | Filename without directory | `doc.md` |
| `${FILE_STEM}` | Filename without extension | `doc` |
| `${FILE_EXT}` | Extension including dot | `.md` |

These are documented in the plugin authoring guide and validated at build time.

### Design Decisions

1. **Statically declared TOML files**: Plugins are bundled at build time, not loaded
   from external paths at runtime.
   This keeps the app self-contained and avoids security issues with arbitrary code
   execution from config directories.
   Future versions could add a user plugin directory.

2. **TOML over JSON/YAML**: TOML is the most readable for non-developers, has a formal
   spec (toml.io), and is well-supported in TypeScript via `smol-toml` or `@iarna/toml`.
   It's also what Rust's cargo uses — familiar to many users.

3. **CLI commands, not scripts**: Plugins specify a CLI command string with variable
   substitution. They don't execute arbitrary JavaScript in the app's context.
   This is intentionally limited: plugins are shell command launchers with file path
   injection.

### Test / Proof-of-Concept Plugins

Three TOML files bundled in the app to validate the system:

**`export-pdf.toml`:**
```toml
name = "Export to PDF"
description = "Render the current document to PDF via pandoc"
command = "pandoc \"${FILE}\" --from markdown --to pdf -o \"${FILE_STEM}.pdf\""
category = "Export"
```

**`export-latex.toml`:**
```toml
name = "Export to LaTeX"
description = "Convert the current document to LaTeX source"
command = "pandoc \"${FILE}\" --from markdown --to latex -o \"${FILE_STEM}.tex\""
category = "Export"
```

**`export-html.toml`:**
```toml
name = "Export to HTML"
description = "Convert the current document to a standalone HTML file"
command = "pandoc \"${FILE}\" --from markdown --to html --standalone -o \"${FILE_STEM}.html\""
category = "Export"
```

These prove:
- The menu reads from a directory of `.toml` files
- Variable substitution works correctly (including quoting for paths with spaces)
- CLI commands execute and produce output files
- The menu updates automatically when TOML files are added/removed at build time

### Can This Already Be Done? (Menu System)

The *menu system* that the Plugin dropdown depends on could theoretically be replaced
by:
- nvim's `:!` command to run shell commands directly (but no GUI discoverability)
- nvim `toggleterm` or `vim-dispatch` for async command running (keyboard-only, not
  mouse-friendly)
- Telescope's built-in `:Telescope commands` or custom pickers (terminal-centric only)

None of these surface in the browser GUI. If the goal is GUI discoverability of external
tools, the menu system must be in-app.

**This feature is blocked by**: Researching and choosing the shared menu framework (see
`settings-dropdown-pandoc-command.md`).

### Plugin Menu UI

Same shared menu framework as Settings and File (see
`settings-dropdown-pandoc-command.md`).

```
+-- Plugin -----------------------------+
| Export                                |
|   Export to PDF                       |
|   Export to LaTeX                     |
|   Export to HTML                      |
+---------------------------------------+
```

- Menu items are grouped by `category` field (submenus in the shared framework)
- Clicking a plugin item runs the command via the server (Node.js `exec` or `spawn`)
  with the current file path substituted
- Output is shown in a status bar message or a small notification
- Errors are shown in the preview area or a dedicated output pane

### Output Handling

- Commands run on the server (not the browser) since they access the filesystem
- Server sends the plugin menu definition to the client on connect
- Client sends "run plugin X" message to server
- Server executes the command and returns stdout/stderr/exit code
- Client shows a brief success/failure indicator

### Server-Side Plugin Execution

```typescript
// Plugin registry (built from TOML files at build time)
interface Plugin {
  name: string;
  description: string;
  command: string;
  category: string;
}

// Variable interpolation
function interpolate(command: string, filePath: string): string {
  const vars = {
    FILE: filePath,
    FILE_DIR: path.dirname(filePath),
    FILE_NAME: path.basename(filePath),
    FILE_STEM: path.basename(filePath, path.extname(filePath)),
    FILE_EXT: path.extname(filePath),
  };
  return command.replace(/\$\{(\w+)\}/g, (_, name) => vars[name] ?? `\${${name}}`);
}

// Execution
async function runPlugin(plugin: Plugin, filePath: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cmd = interpolate(plugin.command, filePath);
  const result = execSync(cmd, { timeout: 30000, cwd: path.dirname(filePath) });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 0 };
}
```

## Human Decisions Needed

1. **Plugin scope**: CLI commands only (safe) vs.
   allowing JavaScript plugins that can modify the app's behavior.
   CLI-only is recommended for v1.
2. **User plugin directory**: Should users be able to add `.toml` files to
   `~/.config/pandoc-preview/plugins/` without rebuilding the app?
   This is the most requested feature and should be planned for v2.
3. **Command timeout**: 30s default?
   Configurable per-plugin?
4. **Shell vs. direct exec**: `execSync` goes through a shell (supports pipes, redirects,
   env vars). Direct `spawn` is safer.
   Recommend direct `spawn` with parsed command tokens, or document that shell features
   are not available.
5. **Output display**: Toast notification vs.
   dedicated output panel vs.
   replace preview area with output.
   Toast is simplest for MVP.

## Risks

- Command injection if variable substitution is not properly escaped.
  **Mitigation**: All path variables are quoted in the example.
  The interpolation function should escape shell metacharacters or use `spawn` with
  argument array instead of shell string.
- Long-running commands blocking the server.
  **Mitigation**: Run with a timeout.
  Use async exec for long operations.
- Commands that modify files without confirmation.
  **Mitigation**: Plugins are bundled at build time; user-added plugins require explicit
  opt-in.

## Non-Goals

- Plugin marketplace or remote discovery
- Plugin dependencies or versioning
- GUI for creating/editing plugins
- Runtime plugin loading from arbitrary paths
