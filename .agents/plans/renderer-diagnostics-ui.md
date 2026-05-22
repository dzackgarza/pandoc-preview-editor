# Feature: Renderer Diagnostics UI

## Goal

- Current defect/state: render failures collapse to a generic `Render failed` preview state
  even though the server already returns `stderr`, timeout messages, and nonzero-exit
  text from the configured renderer.
- Target state: when the configured renderer fails, the app shows a concise diagnostics
  surface in the editor UI with the exact renderer message, keeps the preview pane in a
  coherent failure state, and lets the user recover on the next successful render.
- Why this matters: wrapper scripts, templates, filters, and renderer config are all
  intentionally external to the app. The app still owns render status and must expose
  renderer-owned failures clearly enough that the user can debug their actual pipeline.

## Reference Material

This feature should be implemented by adapting the existing render/status/toast flow, not
by inventing a new UI architecture from scratch.

- Current render boundary:
  - `src/server/render.ts` for renderer process execution, stderr capture, timeout
    handling, and the current `RenderResult` shape
  - `src/server/index.ts` for `/api/render`, result serialization, and in-flight render
    cancellation
- Current client render flow:
  - `src/client/App.tsx` `doRender()` for request/response handling and stale-render
    suppression
  - `src/client/App.tsx` `errorDocument()` for the current minimal failure iframe
    behavior
  - `src/client/App.tsx` `StatusCluster()` for the existing status/footer presentation
- Existing app feedback patterns to reuse:
  - `src/client/App.tsx` plugin success/error toasts as the existing compact
    diagnostics-style UI pattern
  - `src/client/App.tsx` save/plugin/render status chips and timestamp handling for
    session-local status state
- Existing test patterns to adapt:
  - `src/tests/user-behaviors.spec.ts` for dense browser workflow assertions
  - `src/tests/responsiveness.spec.ts` for active-vs-stale render behavior and custom
    renderer config launching
  - `src/tests/helpers.ts` for server launch and render request harnessing

The implementation should start by copying and narrowing one of these existing patterns,
then modifying it for renderer diagnostics. Do not introduce a new diagnostics framework
unless those existing surfaces are first shown to be inadequate.

## Constraints

- Required:
  - Keep the feature renderer-agnostic. Diagnostics may display renderer output, but the
    app must not add renderer-specific request fields, flags, or config editors.
  - Keep the textarea value as the canonical render input; diagnostics derive only from
    `/api/render` results for that text.
  - Reuse existing app surfaces and dependencies already in the repo: the status bar,
    toast patterns, Radix primitives already present in `App.tsx`, and existing render
    fetch flow.
  - Preserve current success behavior: successful renders still replace the iframe HTML,
    update timing, and clear failure state.
- Forbidden:
  - No Settings UI for Pandoc args, filters, templates, or engines.
  - No mock-only tests or isolated glue tests that merely assert JSON shape.
  - No replacement of the preview pane with app-generated renderer-specific markup beyond
    a minimal failure document.
- Approval gates:
  - If the proposed UI needs new persistent config, stop and re-scope. This feature
    should be stateless and session-local.

## Prerequisites

- Confirm the current render contract in `src/server/render.ts` and `src/server/index.ts`
  remains `{ ok, html, durationMs, stderr }`.
- Confirm the current client render flow in `src/client/App.tsx` is the only active path
  for the shipped app; `src/client/main.ts` is legacy and should not drive scope unless
  still built into production.
- Have a failing renderer fixture or wrapper command available in tests so diagnostics
  are proven with real execution rather than fabricated responses.

## Scope

- Included targets:
  - Render failure state management in `src/client/App.tsx`
  - Minimal, human-readable diagnostics surface in the app chrome
  - Server normalization of render failures if needed for stable client handling
  - Real-execution test coverage for failure and recovery
- Excluded/deferred targets:
  - Renderer configuration editing
  - Template/filter management UI
  - Historical diagnostics log, export, or copy-to-clipboard workflows
  - Warning-only stderr display for successful renders unless a concrete user need
    emerges; MVP is failure diagnostics

## Phase 0: Failure Contract Audit

Goal: lock down the exact failure states the UI must represent before changing UI.

### Task 0.1: Audit server-side failure shapes

- Location: `src/server/render.ts`, `src/server/index.ts`
- Description: inventory all current renderer failure modes: process spawn error,
  timeout, nonzero exit with stderr, and cancellation. Decide which are user-facing
  diagnostics and which should remain silent control flow (`Render cancelled`).
- Dependencies: none
- Acceptance criteria: failure modes are documented in the plan implementation notes and
  mapped to user-facing behavior.
- Validation: code inspection plus one manual request path per failure class where
  feasible.

### Task 0.2: Decide the canonical client-side diagnostics model

- Location: `src/client/App.tsx`
- Description: define a small app state object for render diagnostics, e.g.
  `{ kind, summary, detail } | null`, that distinguishes user-visible failure from
  normal rendering and from internally cancelled stale requests.
- Dependencies: Task 0.1
- Acceptance criteria: client state model covers all non-success responses without
  requiring renderer-specific parsing.
- Validation: plan review against the current `/api/render` result fields.

## Phase 1: Server Normalization

Goal: ensure `/api/render` returns enough stable information for the client to render a
consistent diagnostics UI.

### Task 1.1: Normalize render result payload for failures

- Location: `src/server/render.ts`, `src/server/index.ts`
- Description: if needed, split raw stderr from the user-facing summary so the client can
  show a short heading and expandable/raw detail without guessing. A likely shape is
  `{ ok, html, durationMs, stderr, error }`, where `error` is a concise message and
  `stderr` remains the raw renderer text.
- Dependencies: Phase 0 decision on failure model
- Acceptance criteria: every non-success renderer outcome returns a stable summary string
  plus raw detail; cancelled superseded renders do not leak noisy diagnostics into the
  current request path.
- Validation: focused request-level checks using a real failing renderer fixture.

### Task 1.2: Preserve preview-safe failure HTML

- Location: `src/server/render.ts`
- Description: keep returning minimal failure HTML/comment content so the preview iframe
  remains coherent, but treat the dedicated diagnostics payload as the canonical error
  display for the app chrome.
- Dependencies: Task 1.1
- Acceptance criteria: preview remains loadable on failure and the client no longer needs
  to invent the message from a generic fallback string.
- Validation: render request against a failing renderer shows loadable response and
  separate diagnostics fields.

## Phase 2: Client Diagnostics Surface

Goal: expose renderer failures clearly without taking ownership of renderer config.

### Task 2.1: Add session-local diagnostics state

- Location: `src/client/App.tsx`
- Description: add render diagnostics state, clear it on render start or successful
  render, and ignore stale/cancelled responses using the existing render-version guard.
- Dependencies: Phase 1 contract
- Acceptance criteria: stale responses do not overwrite current diagnostics; a successful
  render clears prior failure details.
- Validation: manual rapid-edit scenario plus automated recovery test.

### Task 2.2: Replace generic failure handling with server-provided diagnostics

- Location: `src/client/App.tsx`
- Description: on failed `/api/render`, set `status` to `error`, preserve `durationMs`,
  and populate diagnostics from the server summary/raw stderr rather than hardcoded
  `Render failed`.
- Dependencies: Task 2.1
- Acceptance criteria: renderer timeout, nonzero exit, and spawn errors each show the
  actual message returned by the server.
- Validation: browser test with a failing renderer fixture asserts exact visible text.

### Task 2.3: Add a compact diagnostics UI in existing chrome

- Location: `src/client/App.tsx` near `StatusCluster` and preview container
- Description: add a compact inline diagnostics panel anchored near the status/footer or
  above the preview pane. It should show:
  - a short heading like `Renderer error`
  - the primary summary line
  - expandable or scrollable raw stderr when present
  - a dismiss/close action only if dismissal is session-local and automatically reset on
    the next render
- Dependencies: Tasks 2.1 and 2.2
- Acceptance criteria: the user can read the actual renderer failure without opening dev
  tools; successful renders remove the panel automatically.
- Validation: browser test asserts visible diagnostics panel contents and disappearance
  after recovery.

### Task 2.4: Keep failure preview behavior minimal and stable

- Location: `src/client/App.tsx`
- Description: ensure the preview pane does not display contradictory app-generated error
  prose once the diagnostics panel exists. Either keep a minimal failure document in the
  iframe or preserve last-good HTML, but pick one behavior explicitly and test it.
- Dependencies: Task 2.3
- Acceptance criteria: failure state is visually coherent and does not show duplicate,
  conflicting error messages.
- Validation: browser test asserts the intended iframe behavior exactly.

## Phase 3: Verification

Goal: prove the feature through real renderer execution and realistic user recovery.

### Task 3.1: Add a real failing renderer fixture

- Location: `src/tests/` with a small executable fixture and test config file pattern
- Description: add a tiny renderer fixture that exits nonzero and writes deterministic
  stderr, plus optionally a timeout fixture if timeout messaging is materially different.
- Dependencies: none
- Acceptance criteria: tests can launch the app against a failing configured renderer
  without mocks.
- Validation: fixture invoked through the same server render path as production.

### Task 3.2: Add one dense browser workflow test for diagnostics and recovery

- Location: `src/tests/user-behaviors.spec.ts` or a tightly scoped new browser spec
- Description: drive a realistic session:
  1. launch with failing renderer config
  2. type markdown
  3. assert `error` status plus exact diagnostics text
  4. assert the chosen iframe behavior
  5. relaunch or switch to a working renderer config
  6. assert diagnostics disappear and preview shows exact rendered content
- Dependencies: Tasks 2.1-2.4 and failing fixture
- Acceptance criteria: a passing browser test proves visible failure details and
  successful recovery in one session or two tightly linked sessions.
- Validation: `just test` or the nearest existing browser recipe through `just`.

### Task 3.3: Add one focused request-level parity test only if it proves a unique server boundary

- Location: `src/tests/` alongside existing request-oriented tests
- Description: only add this if browser coverage cannot adequately pin the server
  contract. If needed, assert that a real failing renderer returns the normalized summary
  and raw stderr fields without mangling.
- Dependencies: Task 1.1
- Acceptance criteria: test covers server normalization, not trivial Express plumbing.
- Validation: run alongside the rest of the test suite.

## System-Level Validation

- End-to-end checks:
  - Failing configured renderer shows exact visible diagnostics in the app UI.
  - Status bar reflects `error` during failure and returns to `ready` after a successful
    render.
  - Preview behavior in failure state matches the chosen product decision exactly.
  - Successful rerender clears stale diagnostics and shows the correct renderer output.
- Real-use smoke checks:
  - Nonzero exit with stderr
  - Timeout message
  - Missing executable or spawn error
  - Rapid consecutive edits do not surface cancelled-render noise as a user-visible
    failure
- Commands:
  - `just typecheck`
  - the project’s existing `just` test recipe for browser and integration coverage

## Risks / Rollback

- Risks:
  - Duplicating diagnostics in both iframe and app chrome produces noisy UI.
  - Surfacing cancelled superseded renders as real errors regresses responsiveness.
  - Overfitting the UI to Pandoc-specific wording breaks renderer agnosticism.
- Mitigations:
  - Keep one canonical diagnostics panel and one intentionally minimal iframe state.
  - Treat cancellation as internal control flow unless it is the active request outcome.
  - Use server-provided generic summary/detail fields without parsing Pandoc semantics.
- Rollback path:
  - Revert the diagnostics panel and normalized payload changes together, keeping the
    existing generic failure document and status handling intact.

## Stop Rules

- Do not proceed with UI implementation until the failure-state contract distinguishes
  active render failures from cancelled stale renders.
- Do not add renderer-specific settings, template selectors, or filter toggles as part
  of this feature.
- Do not add server-only tests that merely restate Express JSON output if the browser
  workflow already proves the behavior.
- Do not ship a diagnostics panel that cannot be cleared by the next successful render.

## Execution Progress

### Prerequisites

- [ ] Confirm current `/api/render` contract and active client entrypoint
- [ ] Identify real failing renderer fixture strategy

### Phase 0: Failure Contract Audit

- [ ] Task 0.1: Audit server-side failure shapes
- [ ] Task 0.2: Decide the canonical client-side diagnostics model

### Phase 1: Server Normalization

- [ ] Task 1.1: Normalize render result payload for failures
- [ ] Task 1.2: Preserve preview-safe failure HTML

### Phase 2: Client Diagnostics Surface

- [ ] Task 2.1: Add session-local diagnostics state
- [ ] Task 2.2: Replace generic failure handling with server-provided diagnostics
- [ ] Task 2.3: Add a compact diagnostics UI in existing chrome
- [ ] Task 2.4: Keep failure preview behavior minimal and stable

### Phase 3: Verification

- [ ] Task 3.1: Add a real failing renderer fixture
- [ ] Task 3.2: Add one dense browser workflow test for diagnostics and recovery
- [ ] Task 3.3: Add one focused request-level parity test only if needed

### System-Level Validation

- [ ] End-to-end checks pass
- [ ] Real-use smoke checks pass

### Quality Gates

- [ ] Completeness verified
- [ ] Actionability verified
- [ ] Design sensibility verified
- [ ] Test quality verified

## TDD Guardrails

- RED first: before changing `src/server/render.ts`, `src/server/index.ts`, or
  `src/client/App.tsx`, add a failing test that proves a repository-owned renderer
  diagnostics behavior the app currently lacks.
- Required first witnesses:
  - a failing browser test for visible diagnostics text and recovery
  - a failing request-level test only if it proves a unique server contract the browser
    test cannot prove
- No production code may be written for this feature until the new test fails for the
  expected reason on current code.
- Tests must use the real renderer boundary via fixture/wrapper commands. No mocks,
  monkeypatching, `xfail`, or `skip`.
- Assertions must prove owned behavior: exact visible diagnostics text, exact error
  status transitions, exact clearing on recovery, and exact treatment of cancelled stale
  renders as non-user-facing.
- GREEN means the smallest code change that makes the new failing test pass. REFACTOR is
  allowed only after the new test and the existing suite are green.
