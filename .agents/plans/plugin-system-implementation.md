# Plugin System Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a minimal CLI-command plugin system that exposes configured commands in the app menu and runs them against the app-tracked file.

**Architecture:** Keep plugins server-owned because they need filesystem access and the current file path. Reuse the existing Radix menubar on the client. Use structured plugin manifests with `command` plus `args`, not shell command strings.

**Tech Stack:** TypeScript, Express, Radix Menubar, `js-toml`, Node `child_process.spawn`, Playwright.

---

### Task 1: Add Regression Tests

**Objective:** Specify the plugin contract before implementing it.

**Files:**
- Create: `src/tests/plugins.spec.ts`
- Modify: `src/tests/user-behaviors.spec.ts`

**Steps:**
- Add API tests that launch the real server against a temp markdown file.
- Assert `GET /api/plugins` returns bundled plugin metadata.
- Assert `POST /api/plugins/export-html/run` creates a real HTML file next to the current file.
- Assert plugin execution saves the current textarea content before running from the browser menu.

### Task 2: Extract Workspace Filesystem Helpers

**Objective:** Make file boundary logic reusable by file routes and plugin execution.

**Files:**
- Create: `src/server/workspace.ts`
- Modify: `src/server/index.ts`

**Steps:**
- Move `resolveInside`, `toClientPath`, text-file detection, ignore handling, and entry sorting into `workspace.ts`.
- Keep route behavior unchanged.
- Reuse the exported helpers from `index.ts`.

### Task 3: Implement Plugin Registry and Runner

**Objective:** Load bundled TOML plugin manifests and execute them without a shell.

**Files:**
- Create: `src/server/plugins.ts`
- Create: `src/server/plugins/export-html.toml`
- Modify: `src/server/index.ts`

**Steps:**
- Parse bundled `.toml` files with `js-toml`.
- Validate required fields: `id`, `name`, `category`, `command`, `args`.
- Interpolate `${FILE}`, `${FILE_DIR}`, `${FILE_NAME}`, `${FILE_STEM}`, and `${FILE_EXT}` inside argv tokens.
- Run plugins with `spawn(command, args, { cwd: file directory })` and a timeout.
- Return stdout, stderr, exit code, and generated output path when known.

### Task 4: Add Plugin API Routes

**Objective:** Expose the plugin registry and run operation to the client.

**Files:**
- Modify: `src/server/index.ts`

**Steps:**
- Add `GET /api/plugins`.
- Add `POST /api/plugins/:id/run` with `{ path, markdown }`.
- Save the supplied markdown to the target file before running the plugin.
- Keep file writes constrained to the workspace root.

### Task 5: Wire the Client Menu

**Objective:** Let users run bundled plugins from the browser UI.

**Files:**
- Modify: `src/client/App.tsx`

**Steps:**
- Load plugin metadata on app start.
- Add a Plugin menu to the existing Radix menubar.
- Group plugin items by category with Radix submenus.
- Run a plugin with the current textarea text and current file path.
- Surface running/success/error state in the existing status area.

### Task 6: Verify

**Objective:** Prove the feature works without regressing current behavior.

**Commands:**
- `just typecheck`
- `just test`

**Expected Result:** Type-check passes and all Playwright/API tests pass.
