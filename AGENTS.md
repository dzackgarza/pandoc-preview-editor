# pandoc-preview Agent Rules

Read this file before editing this repository.
Then read `.agents/plans/FEATURE-EVALUATION-FRAMEWORK.md` and `docs/feature-evaluation-philosophy.md`.

## App Philosophy

- The shipped app is a browser-based plain text editor with live preview.
- Firenvim may own text editing inside the textarea.
  It does not own file identity, workspace state, save targets, server state, or command execution.
- The textarea value is the canonical in-app document text.
  Save, render, export, and plugin actions must use that value plus the app-tracked file path.
- The app owns filesystem interaction: open, new, save, workspace listing, selected-file tracking, and passing file paths to server-side tools.
- The app follows normal editor file semantics.
  It can open with no user file, edit and preview an unsaved buffer, then choose the real path on first save.
- Temporary files are internal backup state only.
  They are not user file identity, and they must not become the save target unless the user explicitly chooses that path.
- Nontrivial actions that need durable context must pass through the save gate first: plugin execution, opening another file, creating a new buffer, figure/asset actions, and any command that needs a path relative to the document.
- The app is renderer agnostic.
  The renderer command is entirely specified by config and may be Pandoc, a wrapper, a chained command, or an unrelated rendering CLI.
- Pandoc templates and filters are centralized assets.
  Expect them under `~/.pandoc/templates/` and `~/.pandoc/filters/`, referenced by config or wrappers.
- Academic reproducibility is a core design constraint.
  Pandoc assets (templates, filters, macros, styles, CSL files) must live under `~/.pandoc/` and be version-controlled like dotfiles, so that paper compilations remain reproducible after system changes (new machine, new institution).
  The app enforces this centralization as a hard rule: the structured UI resolves template and filter flags exclusively through the configured `templates_dir` and `filters_dir`, and deliberately prevents attaching filters or templates from arbitrary filesystem locations.
  The raw command tab bypasses this enforcement but is not the advertised workflow.
- Templates are data, not code.
  Pandoc templates, TikZ wrappers, macros, and style sheets are user-editable files stored under `~/.pandoc/` or the app's config directory.
  No app code may embed template content or construct templates through string manipulation.
  When a new macro package is released or a style needs updating, the user edits a file — no code change, no deployment.
- TikZ diagrams are rendered to SVG via Pandoc on the server side, never through an in-browser JavaScript engine (tikzjax or equivalent).
  TikZjax lacks full TikZ feature coverage, does not support user macros, is outside the app's template control, and — most critically — produces output that is not reproducible outside the app.
  Server-side Pandoc → SVG rendering is externally auditable, handles text vs drawing scaling correctly, and compiles identically on any machine.
- The app uses a fail-fast architecture.
  Unexpected state at any layer must crash promptly and visibly — never silently degrade, never substitute fallback defaults.
  Silenced errors today become unrecoverable research data loss tomorrow.
  A broken build is always cheaper than corrupted output.
- The app is git-native.
  Versioning, crash recovery, and rollback are delegated to git rather than reinvented.
  The GUI prominently indicates whether the active file is tracked in a git repository.
  For a tracked file, saving and committing are the same operation — the save IS a git commit.
  For an untracked file (not in git at all, or inside a repo but never committed) or an unsaved buffer, save and commit necessarily split: the backend writes to its own recovery repo.
  The prominent untracked indicator is a prompt to track the file in git; the split is a temporary condition, not a normal workflow.
  The backend additionally autosaves the current buffer on a short internal timer (sub-10-second debounce) and commits every autosave, so that the maximum recoverable work loss from any crash is a few seconds of editing.
  Commits per save are negligible on modern systems; agents can squash and clean history during maintenance.

## Hard Boundaries

- Do not add app-owned config keys for renderer-specific flags.
  The `render_command` string in config is the single source of truth for the renderer invocation.
  The canonical workflow is: develop and verify a Pandoc command in the terminal first, then paste it into the app config.
  The app consumes the working command; it is not a Pandoc flag builder.
  UI convenience controls are an ephemeral view layer that helps *manage* the resulting long command string — they parse the string on read and reconstruct it on write, never persisting independent flag fields to config.
- Do not copy project-local template/filter paths into the app.
  Keep Pandoc-specific assets centralized under `~/.pandoc`.
- The Settings UI may provide structured controls for common Pandoc flags — standalone, citeproc, TOC, number-sections, embed-resources, math engine, template selection, filter toggles — as a QOL layer on top of the command string.
  Its purpose is to help users discover available flags, browse their centralized templates and filters, and modify their long-running preferred Pandoc invocation without consulting the Pandoc manpage for every option.
  Every edit to a structured control must immediately reconstruct and display the equivalent command string.
  The raw command text tab must always be available as the authoritative view.
- Never catch an exception without surfacing it visibly to the user.
  No silent error swallowing, no fallback defaults, no graceful degradation that masks an unexpected condition.
  Crash immediately — a broken preview is recoverable, corrupted research output is not.
- Assert every invariant at the boundary where data enters the system: config parse results, file paths, renderer exit codes, template and filter existence.
  A null or missing value is a hard failure, not a default to log and ignore.
- Do not embed template content in app code or construct templates through string manipulation.
  Templates are user-editable data files referenced from the render command, never owned by application code.
  For TikZ rendering, a standard Pandoc template in `~/.pandoc/` serves as the injection point; the app does not generate or mutate template content.
- Do not use in-browser TikZ rendering (tikzjax or any equivalent).
  All TikZ must be rendered to SVG via Pandoc on the server side, never through a JavaScript engine in the browser.
  The resulting SVG is embedded as an image in the preview output.
- Do not infer file identity from Firenvim, nvim buffers, temporary files, or editor state.
  File identity belongs to the app/server state model.
- Do not let git recovery history satisfy the save gate.
  The backend recovery repo and the user's git history preserve crash recovery; they do not establish document directory, plugin context, or asset paths.
- Do not implement app-owned crash recovery that duplicates git.
  The backend recovery repo is the crash recovery layer — no separate temporary-file backup formats, no app-owned snapshot system.
- Do not create a real user file for `New` until the user saves content to the chosen path.
  `New` may record a pending target, but the first save must create the file with the current textarea content.
- Do not constrain Save As or New targets to the launch directory.
  Absolute user paths are valid save targets; relative paths resolve inside the current workspace.
- Keep workspace root state consistent with file identity.
  Saving within the current workspace must preserve that workspace; saving outside it must update reload, Explorer, and dialog state to the new file's directory.
- Tests for file workflows must prove exact disk paths and contents, reload persistence, workspace-root updates, and absence of stray files in the repo root.
- Do not preserve obviated feature cards as candidates.
  If Firenvim, nvim, the textarea, or the configured renderer already owns the full user outcome, delete the active card.
- Do not convert an obviated feature into nearby app work unless the user outcome still exists under the current architecture.

## Feature Evaluation

- Define features by user outcome, not by GUI widget.
- Before implementing, decide which layer owns the outcome: Firenvim/nvim, app/client, app/server, config, plugin manifest, or external renderer.
- Use mature existing dependencies for UI and execution boundaries already present in the app.
  Do not hand-roll framework behavior without a documented reason.
- Keep plugin commands separate from the preview renderer.
  Bundled plugins may declare their own commands and args because plugin manifests own those command declarations.

## Testing Rules

- Tests must prove repository-owned behavior with real execution.
  Do not use mocks, skips, or xfails to mask missing dependencies.
- Prefer a few dense workflow tests over many one-feature probes.
  A good Tauri or browser workflow test drives a realistic user process and asserts exact expected state after every meaningful transition: editor text, preview content, file identity, disk contents, save/render status, visible UI, and console errors.
- Do not keep tests that only prove internal consistency, such as `ok` flags, non-null values, or weak substring checks.
  Assert exact observable outcomes.
- For preview correctness, use Pandoc as the oracle.
  The proof is that content entered through the app appears in the preview iframe exactly as the configured renderer would emit it, not that an Express endpoint returned a plausible response.
- The server is mostly glue.
  Test it only for renderer parity/non-mangling or concrete app-owned filesystem/plugin boundaries.
  Do not build isolated server tests for trivial request/response plumbing.
- Keep tests separate only when they need clean state or are proving a specific bug boundary.
  Otherwise group related user behaviors into one realistic session and assert intermediate states heavily.
- Tauri and browser workflow tests fail on browser console errors, not warnings.
- Run project checks through `just`; use the existing recipes for type-checking, building, and tests.

## Tauri Playwright Plugin Testing

This repo uses `@srsholmes/tauri-playwright`, not ordinary Playwright against a browser page.
Before editing `src/tests/`, read the installed package docs and types:

- `node_modules/@srsholmes/tauri-playwright/README.md`
- `node_modules/@srsholmes/tauri-playwright/dist/index.d.ts`
- `src/tests/e2e/fixtures.ts`
- `src/tests/playwright.config.ts`
- `src/tests/e2e/editor-helpers.ts`

Also consult the upstream plugin docs and examples when the local package docs are unclear:

- `https://github.com/srsholmes/tauri-playwright`
- `https://docs.rs/crate/tauri-plugin-playwright`
- `https://github.com/srsholmes/tauri-playwright/tree/main/examples/hello-world`
- `https://github.com/techtoboggan/librecode/blob/main/packages/app/e2e/fixtures/tauri-real.ts`
- `https://github.com/theoryzhenkov/posthaste/blob/main/tools/lab/tauri-playwright/fixtures.ts`
- `https://github.com/aadivyaraushan/anvil/blob/main/apps/desktop/e2e-tauri/fixtures.ts`
- `https://v2.tauri.app/develop/tests/webdriver/`
- `https://playwright.dev/docs/best-practices`
- `https://playwright.dev/docs/locators`

Do not substitute generic Playwright knowledge for the plugin contract.
Generic Playwright best practices apply only where the plugin exposes the same surface.

### Research Basis and Stability

The mature Tauri testing baseline is Tauri's documented native boundary: unit/integration tests through Tauri's mock runtime and end-to-end tests through native desktop automation such as `tauri-driver`/WebDriver.
The exact `@srsholmes/tauri-playwright` package is newer and has fewer public production examples.
Therefore, treat the accepted pattern in this repo as the intersection of:

- Tauri's official distinction between mock-runtime tests and native desktop end-to-end tests.
- The plugin's own documented mode split: `browser`, `tauri`, and Windows-only `cdp`.
- The plugin's installed TypeScript definitions, not remembered Playwright `Page` APIs.
- Public plugin adopters that keep one real-Tauri fixture, explicit socket/config state, and clear separation between browser mocks and desktop proofs.

Do not claim a pattern is "mature Tauri practice" merely because it is ordinary web Playwright practice.
For this repo, ordinary web Playwright is only mature guidance for selectors, retries, assertions, and artifact review after those ideas have been translated through the plugin's supported `TauriPage` surface.

### Plugin Architecture Facts

- `browser` mode is headless Chromium with mocked Tauri IPC. It is useful for shell/harness checks only.
  It is not a proof of this app's Tauri IPC, filesystem, renderer, plugin, config, save, recovery, or workspace behavior.
- `tauri` mode drives the real Tauri webview through `tauri-plugin-playwright`'s socket bridge.
  Feature proofs for this repo must run in `tauri` mode unless the test is explicitly labeled as browser-smoke.
- `cdp` mode is Windows-only WebView2 CDP. Do not design Linux tests around it.
- Tauri's official WebDriver path is separate from this plugin.
  The official Tauri docs explain why native desktop webview testing is platform-constrained; do not treat ordinary Chromium Playwright as real Tauri coverage.
- This repo has `withGlobalTauri: true` in `src-tauri/tauri.conf.json` and initializes `tauri_plugin_playwright::init()` in `src-tauri/src/lib.rs`. The plugin is already embedded in the app; tests should use that boundary rather than inventing another app driver.

### Accepted Correct Patterns

Every spec must declare which proof boundary it exercises before the first assertion:

- **Browser-smoke:** runs React in headless Chromium with mocked Tauri IPC. It may prove that the shell mounts, selectors exist, and browser-only rendering glue still works.
  It does not prove desktop IPC, native filesystem, renderer invocation, workspace semantics, save/commit behavior, or plugin execution.
- **Tauri desktop proof:** runs the real app with `tauri-plugin-playwright` compiled in and drives the real webview through the plugin socket.
  This is the required boundary for feature proof obligations in `docs/testing-proof-obligations.md`.
- **Rust/unit boundary:** proves pure backend logic or command parsing without the UI. It cannot replace a desktop proof when the behavior depends on the textarea, UI state, native IPC, filesystem identity, renderer stderr, or workspace transitions.
- **Official WebDriver boundary:** acceptable only when deliberately replacing this plugin with `tauri-driver`/WebDriver for a test class.
  Do not mix WebDriver assumptions into `@srsholmes/tauri-playwright` specs.

The accepted Tauri fixture shape is:

- One shared fixture module imports `createTauriTest` and exports the repository's `test` and plugin `expect`.
- The fixture sets the real `devUrl`, `tauriCommand`, `tauriCwd`, `tauriFeatures` when the plugin is feature-gated, `mcpSocket`, and a realistic `startTimeout`.
- The socket is explicit.
  For any future parallel or multi-project run, use a private per-run socket and fail fast if it is missing, outside the run directory, or the plugin default would collide.
- The Tauri command launches the real desktop app, not a static server, Express fallback, browser-only Vite page, or alternate harness.
- Browser IPC mocks live only in browser-smoke configuration.
  They are never imported into Tauri desktop proofs.
- The app and tests use isolated HOME/XDG/config/workspace/session directories created by the fixture or test setup.
  Test state must not depend on the user's real config or stale files under `test-results`.

The accepted spec pattern is:

- Drive user-visible workflow through `tauriPage` locators and actions.
  Do not call Rust commands directly to skip UI ownership unless the proof boundary is explicitly a command/unit test.
- Assert the externally owned result after each transition: textarea value, preview iframe content, current file path, exact disk contents, TOML config contents, renderer status, plugin status, git/recovery status, and visible diagnostics as applicable.
- Use the shared helpers for editor mutation and preview iframe reads.
  If a helper is wrong, fix the shared helper; do not copy a weaker local variant into a spec.
- Use `TauriPage.evaluate` only with a JavaScript string and only to inspect real webview state that the plugin locator surface cannot expose.
  Return serializable values and assert exact data, not loose existence.
- Keep hard dependencies real and loud.
  Missing Pandoc, TeX tools, Xvfb/WebKitGTK libraries, renderer commands, plugin sockets, or config files are setup failures that must be visible in the failure evidence.
- Review plugin-native artifacts and process logs for Tauri failures.
  Standard Playwright browser traces in Tauri mode may observe the control page rather than the real desktop webview; use plugin-native screenshots/video when available plus browser console, Tauri/Rust stderr, renderer stderr, and filesystem/config artifacts.

### Fixture and Config Rules

- Import `test` and `expect` from `src/tests/e2e/fixtures.ts`, not directly from `@playwright/test`, in Tauri E2E specs.
  The fixture's `expect` carries the plugin's locator assertions.
- Use `createTauriTest(...)` as the single source of the Tauri fixture.
  Do not create parallel launch helpers, alternate app servers, or ad hoc IPC mock layers.
- Use the fixture-provided `appPage`/`tauriPage` as a `TauriPage` in desktop proofs.
  Do not pass around untyped `page`, `any`, or fake globals.
- Project config must distinguish `browser-smoke` and `tauri`. Browser project tests may use `ipcMocks`; Tauri project tests must not use `ipcMocks` as feature evidence.
- If TypeScript does not understand a custom project option such as `mode`, fix the type surface narrowly or use a precise documented suppression at that property.
  Do not cast an entire project config to `any`.
- Keep `workers: 1` and serial desktop behavior unless a documented plugin/app lifecycle change proves parallel Tauri app instances are safe.
  This app has singleton desktop/server assumptions.

### Supported `TauriPage` Surface

`TauriPage` is Playwright-like, not a full `Page`. Use only methods present in `dist/index.d.ts`.

Supported patterns include:

- `tauriPage.locator(selector)`, `getByTestId`, `getByText`, `getByRole`, `getByLabel`, `getByPlaceholder`, `getByTitle`, and locator chaining/filtering.
- Locator actions: `click`, `fill`, `press`, `clear`, `pressSequentially`, `hover`, `focus`, `scrollIntoViewIfNeeded`, `dispatchEvent`.
- Page actions: `click(selector)`, `fill(selector, text)`, `keyboard.press`, `keyboard.type`, `keyboard.insertText`, `mouse.click`, `reload`, `waitForFunction`, `waitForSelector`.
- Queries: `textContent`, `innerText`, `innerHTML`, `inputValue`, `getAttribute`, `count`, `evaluate`.
- Plugin assertions from the fixture `expect`: `toBeVisible`, `toBeHidden`, `toContainText`, `toHaveText`, `toHaveValue`, `toHaveAttribute`, `toHaveCount`, page `toHaveURL`, and page `toHaveTitle`.

Unsupported or dangerous patterns:

- Do not use `frameLocator`; `TauriPage` does not expose it.
  For preview iframe content, use the shared helper that calls `evaluate` against `#preview.contentDocument`.
- Do not pass browser-style callback functions to `TauriPage.evaluate`. The plugin API takes a JavaScript string.
- Do not use `page.route(...)` or plugin network routing to fake renderer, filesystem, plugin, or IPC behavior for feature proofs.
- Do not use `getCapturedInvokes`, `emitMockEvent`, or `ipcMocks` as evidence in Tauri desktop proofs.
  Those are browser-mode mock tools.
- Do not add local helper copies that weaken the shared polling, typing, or iframe access behavior in `editor-helpers.ts`.
- Do not hide unsupported API usage behind `as any`, `@ts-nocheck`, broad `Record<string, unknown>` casts, or fake window globals.

### Mature Playwright Practice Adapted to the Plugin

The relevant mature practice is not "use Playwright" generically.
It is: use stable locators, auto-waiting actions, web-first assertions, traces/artifacts, and isolated state through the plugin's `TauriPage` surface.

- Prefer user-facing locators and stable explicit contracts: role/name where the adapter supports it, then text, then `data-testid`. Avoid brittle CSS chains tied to layout or styling.
- Use plugin locator assertions instead of manual instantaneous checks.
  `await expect(locator).toBeVisible()` is better than `expect(await locator.isVisible()).toBe(true)` because the former retries.
- Assert exact owned outcomes after every meaningful transition: editor contents, preview text/HTML, current file path, disk contents, config TOML, save/render/plugin status, diagnostics, and console errors.
- Use `expect.poll` only for app-owned asynchronous state that has no locator assertion, such as preview iframe text read through `evaluate` or disk contents.
  The poll body must inspect real state and the assertion must be exact enough to fail on wrong content.
- Keep tests isolated with fresh temp HOME/XDG/workspace/config/session state.
  Do not rely on global user config or stale `test-results` artifacts.
- Use real commands and files for feature proofs: real Tauri IPC, real filesystem paths, real renderer command, real plugin command, real dialog state when applicable.
- Use browser-smoke mocks only to prove the React shell can mount in a mocked Tauri environment.
  Label those tests as harness checks, not product proofs.
- Use traces, screenshots, videos, console output, Tauri/Rust stderr, and renderer stderr for debugging.
  Do not respond to a timeout by only increasing the timeout.
- Keep dependency failures visible.
  If Pandoc, pdflatex, xvfb, the renderer command, or the plugin socket is missing, the test should expose that setup failure rather than skip the proof.

### Debugging Failed Tauri Playwright Tests

Before editing app code or tests after a failure, classify the first incorrect boundary:

- **App defect:** the test correctly models a documented proof obligation, uses the real plugin boundary, and the app violates the contract.
- **Incorrect test:** the test asserts behavior contradicted by AGENTS.md, `docs/testing-proof-obligations.md`, real data shape, or current architecture.
- **Plugin/API misuse:** the test uses generic Playwright APIs not exposed by `TauriPage`, uses browser-mode assumptions in Tauri mode, or type-escapes the adapter.
- **Fixture/config defect:** the test builds impossible temp state, leaks HOME/XDG/session state, omits a hard dependency, or asserts on fixture setup instead of app behavior.
- **Invalid proof design:** the test can pass without proving the owned behavior, uses mocks for a feature proof, asserts shape/existence only, depends on arbitrary timing, or preserves obsolete Express/TikZJax/static-server behavior.

Every failed-test repair must leave a visible causal note containing:

- exact command, project, spec, environment, and retry count;
- Playwright stdout/stderr, browser console, Tauri/Rust stderr, renderer stderr, screenshots/traces/videos, and relevant artifact paths;
- the proof obligation under test;
- the first boundary where actual state diverges from expected state;
- competing hypotheses and the observation that eliminated each one;
- why the final edit fixes the established cause rather than making the test easier to pass.

After two failed fix attempts on the same test, stop editing and review the causal note.
Do not keep patching assertions, helpers, fixture setup, adapter calls, or timeouts without a new observation that changes the diagnosis.

### Predictable Agent Failure Modes

Future agents working on this suite are likely to:

- confuse generic Playwright `Page` with plugin `TauriPage`;
- convert Tauri proofs into browser-mode mocked IPC tests;
- use `frameLocator`, callback `evaluate`, or route mocking because they remember normal Playwright;
- add `as any` or `@ts-nocheck` around adapter type errors;
- use direct IPC to avoid driving the UI workflow;
- increase timeouts and retries instead of finding the first bad boundary;
- rewrite expectations to match current app behavior;
- skip missing dependencies instead of surfacing setup failure;
- duplicate helpers locally instead of fixing `editor-helpers.ts`;
- count Rust helper tests, browser-smoke tests, or targeted green specs as proof that the desktop app satisfies the behavior burden.

All of these are review blockers.
