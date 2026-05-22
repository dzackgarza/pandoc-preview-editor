# Feature: Centralized Pandoc Template/Filter QA

## Goal

- Current defect/state: the repo has separate notes for template output QA and filter QA,
  but the open TODO item is one combined renderer-boundary task and does not yet have a
  single execution plan that covers both sides together.
- Target state: the repo has one renderer-agnostic QA plan that proves the app respects
  centralized `~/.pandoc/templates/` and `~/.pandoc/filters/` through the configured
  renderer command without adding app-owned template or filter controls.
- Why this matters: template and filter failures are part of the real renderer boundary.
  The app must prove renderer parity and non-mangling, while leaving template/filter
  ownership in user config and wrapper commands.

## Reference Material

This plan should consolidate and extend existing repo material rather than reasoning
about template/filter QA from scratch.

- Existing source plans to merge:
  - `.agents/plans/html-template-rendering.md`
  - `.agents/plans/pandoc-filters-testing.md`
  - `.agents/plans/renderer-diagnostics-ui.md` for the shared failure-surfacing path
- Existing test harness and fixture patterns:
  - `src/tests/helpers.ts` for launching the app with custom renderer configs
  - `src/tests/responsiveness.spec.ts` for custom config fixtures and wrapper-driven
    render testing
  - `src/tests/user-behaviors.spec.ts` for dense browser workflow checks
- Existing server/client boundaries to preserve:
  - `src/server/render.ts` and `src/server/index.ts` for renderer execution and response
    shaping
  - `src/client/App.tsx` for preview rendering and diagnostics consumption

Implementation work here should primarily be plan consolidation plus targeted adaptation
of the existing wrapper-fixture approach already used elsewhere in the repo. Do not
design a brand-new QA architecture if the existing test harness can be extended.

## Constraints

- Required:
  - Keep template and filter selection in config or wrapper commands, not in app request
    fields or UI.
  - Treat Pandoc as the oracle for preview correctness where possible.
  - Reuse the existing server launch/test harness in `src/tests/helpers.ts`.
  - Keep tests focused on repository-owned behavior: invocation parity, surfaced
    diagnostics, and unmodified renderer output.
- Forbidden:
  - No app-owned template picker, filter picker, or renderer argument editor.
  - No project-local copies of `~/.pandoc/templates/` or `~/.pandoc/filters/`.
  - No mock-only tests that fake renderer output instead of running a real wrapper or
    command.
- Approval gates:
  - If proving this feature requires shipping centralized Pandoc assets in the repo,
    stop and re-scope. This task is QA around existing external assets, not asset
    ownership.

## Prerequisites

- Confirm the current render contract in `src/server/render.ts` and
  `src/server/index.ts`.
- Confirm the existing test harness can launch the app with a custom config path and
  renderer command.
- Decide whether the QA path uses real user-local centralized assets for manual QA,
  deterministic in-repo wrapper fixtures for automated coverage, or both.

## Scope

- Included targets:
  - One canonical in-repo plan for template and filter QA together
  - Renderer-boundary test fixtures or wrapper commands under `src/tests/`
  - Browser and/or request-level verification that the app passes renderer output
    through unchanged and surfaces failures clearly
  - Manual QA notes for user-local centralized assets when deterministic automated
    coverage is not possible
- Excluded targets:
  - Implementing template/filter management UI
  - Taking ownership of third-party filter correctness
  - Exhaustive testing of every user-local Pandoc asset under `~/.pandoc`

## Phase 0: Boundary Definition

Goal: pin down exactly what the app owns and what the external renderer owns.

### Task 0.1: Consolidate the existing template/filter QA notes

- Location: `TODO.md`, `.agents/plans/html-template-rendering.md`,
  `.agents/plans/pandoc-filters-testing.md`
- Description: treat the existing template and filter notes as source material and
  consolidate them into one executable scope: prove renderer invocation parity, prove
  renderer output is displayed, and prove stderr/nonzero exits surface in the app.
- Dependencies: none
- Acceptance criteria: the combined scope is explicit and excludes app-owned template or
  filter controls.
- Validation: plan review against repo rules in `AGENTS.md`.

### Task 0.2: Define canonical verification modes

- Location: `src/tests/helpers.ts`, `src/tests/`
- Description: separate verification into:
  - deterministic automated checks using in-repo renderer wrappers/fixtures
  - optional manual QA against user-local centralized assets under `~/.pandoc`
- Dependencies: Task 0.1
- Acceptance criteria: automated and manual checks each have clear ownership and purpose.
- Validation: plan review plus existing harness inspection.

## Phase 1: Automated Renderer-Boundary Coverage

Goal: add deterministic automated coverage without taking ownership of the user’s real
Pandoc asset tree.

### Task 1.1: Add template-output wrapper fixture

- Location: `src/tests/` and a dedicated test config fixture
- Description: add a small renderer wrapper script that emits representative full HTML
  structure analogous to a centralized template-driven render. The script should be
  deterministic and should also support a failure mode that writes stderr and exits
  nonzero.
- Dependencies: Phase 0 scope
- Acceptance criteria: tests can launch the app against the wrapper and observe exact
  HTML passthrough plus surfaced diagnostics.
- Validation: direct invocation of the wrapper and app-driven render through `/api/render`.

### Task 1.2: Add filter-output wrapper fixture

- Location: `src/tests/` and a dedicated test config fixture
- Description: add a deterministic renderer wrapper that simulates filter-transformed
  HTML output from markdown input, such as emitted `<img>`/`<svg>` or transformed block
  structure, without requiring user-local filter installation in CI.
- Dependencies: Task 1.1
- Acceptance criteria: tests prove the app displays renderer-produced transformed HTML
  rather than raw markdown source and does not inject app-owned filter semantics.
- Validation: app render through the wrapper plus exact DOM assertions in browser tests.

### Task 1.3: Add failure-path fixture coverage

- Location: `src/tests/`
- Description: ensure at least one deterministic failure mode exists for both template-
  style and filter-style wrapper configs so stderr/nonzero exits are exercised through
  the same UI diagnostics path.
- Dependencies: Tasks 1.1 and 1.2
- Acceptance criteria: automated coverage proves exact surfaced error text for renderer
  failures.
- Validation: browser or request-level tests with exact assertions on visible diagnostics
  and/or response payload.

## Phase 2: Manual Centralized-Asset QA

Goal: define a repeatable manual check for real `~/.pandoc` setups without turning them
into app-owned fixtures.

### Task 2.1: Define manual template QA procedure

- Location: `.agents/plans/centralized-pandoc-template-filter-qa.md`
- Description: document a concise manual workflow using a user-local renderer or wrapper
  that references `~/.pandoc/templates/`, along with a representative markdown document
  that exercises title metadata, headings, lists, code blocks, and any template shell
  structure the preview should preserve.
- Dependencies: Phase 1 contract
- Acceptance criteria: manual QA steps are precise enough that another agent can run them
  without re-deriving scope.
- Validation: checklist review and optional local smoke run.

### Task 2.2: Define manual filter QA procedure

- Location: `.agents/plans/centralized-pandoc-template-filter-qa.md`
- Description: document a concise manual workflow using a user-local renderer or wrapper
  that references centralized filters under `~/.pandoc/filters/`, including at least one
  transformed-content example and one failure example.
- Dependencies: Task 2.1
- Acceptance criteria: manual QA proves the app passes through transformed renderer
  output and surfaces renderer stderr without pretending to validate all filter logic.
- Validation: checklist review and optional local smoke run.

## Phase 3: Verification Integration

Goal: keep the QA plan anchored in real repo workflows.

### Task 3.1: Add one dense browser workflow test

- Location: `src/tests/user-behaviors.spec.ts` or a tightly scoped new spec
- Description: drive one realistic user session against a deterministic wrapper config
  and assert:
  - preview shows full HTML output from the renderer
  - transformed content appears exactly as emitted
  - diagnostics appear on failure and clear on recovery
- Dependencies: Phase 1 fixtures
- Acceptance criteria: one browser test proves the owned user outcome at the app layer.
- Validation: existing `just` browser test recipe.

### Task 3.2: Add request-level parity test only if it covers a unique boundary

- Location: `src/tests/`
- Description: if needed, add a focused request-level test to assert `/api/render` does
  not mangle stdout/stderr returned by the configured wrapper. Skip this if the browser
  workflow already proves the same fact.
- Dependencies: Task 3.1
- Acceptance criteria: any added request-level test proves a unique contract, not trivial
  JSON plumbing.
- Validation: existing `just` test recipe.

## System-Level Validation

- End-to-end checks:
  - A configured wrapper that behaves like a template-driven renderer produces exact
    preview output in the iframe.
  - A configured wrapper that behaves like a filter-driven renderer produces exact
    transformed output in the iframe.
  - Renderer stderr/nonzero exits surface through the app diagnostics path.
  - No app-owned template/filter request fields or UI are introduced.
- Real-use smoke checks:
  - Working template-style wrapper
  - Working filter-style wrapper
  - Nonzero-exit failure path
  - Recovery from failure to success
- Commands:
  - `just typecheck`
  - repo `just` test recipe covering browser/integration tests

## Risks / Rollback

- Risks:
  - Automated fixtures may drift into reimplementing Pandoc instead of testing the app
    boundary.
  - Manual QA notes may accidentally imply app ownership of centralized assets.
  - The combined plan may duplicate coverage already provided by renderer diagnostics.
- Mitigations:
  - Keep fixtures minimal and boundary-focused.
  - Phrase manual QA explicitly as user-local environment validation.
  - Reuse the renderer diagnostics path rather than inventing separate failure UI.
- Rollback path:
  - Remove wrapper fixtures and tests together, preserving the app’s current
    renderer-agnostic behavior.

## Stop Rules

- Do not add template/filter controls to the app.
- Do not copy centralized Pandoc assets into the repo as part of this QA work.
- Do not add server-only tests unless they prove a contract the browser workflow cannot.
- Do not claim template/filter correctness beyond renderer-boundary parity and surfaced
  diagnostics.

## Execution Progress

### Prerequisites

- [ ] Confirm current render contract and test harness constraints
- [ ] Decide deterministic automated-fixture strategy

### Phase 0: Boundary Definition

- [ ] Task 0.1: Consolidate the existing template/filter QA notes
- [ ] Task 0.2: Define canonical verification modes

### Phase 1: Automated Renderer-Boundary Coverage

- [ ] Task 1.1: Add template-output wrapper fixture
- [ ] Task 1.2: Add filter-output wrapper fixture
- [ ] Task 1.3: Add failure-path fixture coverage

### Phase 2: Manual Centralized-Asset QA

- [ ] Task 2.1: Define manual template QA procedure
- [ ] Task 2.2: Define manual filter QA procedure

### Phase 3: Verification Integration

- [ ] Task 3.1: Add one dense browser workflow test
- [ ] Task 3.2: Add request-level parity test only if needed

### System-Level Validation

- [ ] End-to-end checks pass
- [ ] Real-use smoke checks pass

### Quality Gates

- [ ] Completeness verified
- [ ] Actionability verified
- [ ] Design sensibility verified
- [ ] Test quality verified

## TDD Guardrails

- RED first: before adding any wrapper fixture, test config, or app change, write a
  failing test that proves repository-owned renderer-boundary behavior that is missing or
  unproven today.
- Required first witnesses:
  - one failing browser workflow test showing exact preview passthrough from a
    template-style or filter-style wrapper
  - one failing diagnostics test only where the browser workflow cannot already prove the
    same contract
- No production code or fixture adaptation beyond test setup may be treated as valid
  implementation until the new test has been run and observed failing for the expected
  reason.
- Tests must exercise the real render path through configured wrapper commands. No mocks,
  no fake JSON responses, no `xfail`, and no `skip`.
- Assertions must prove owned behavior only: exact stdout passthrough, exact transformed
  renderer output in preview, and exact surfaced stderr/nonzero-exit handling. Do not
  assert generic Pandoc correctness the repo does not own.
- GREEN means the minimal change that makes the failing proof pass while the existing
  suite remains green.
