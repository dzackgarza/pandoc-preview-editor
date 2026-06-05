# Requirements Freeze and Authority Extraction

## Goal

- **Current state**: The repository lacks a single, implementation-independent requirements authority. Knowledge is scattered across `AGENTS.md`, `TODO.md`, various docs, and existing code.
- **Target state**: A normative requirements authority consisting of `REQUIREMENTS.md` (abstract), `DESIGN-COMMITMENTS.md` (concrete), and `REQUIREMENTS-LEDGER.md` (evidence ledger).
- **Why this matters**: To prevent architectural drift, clarify ownership, and provide a stable specification for upcoming remediation work and future features.

## Constraints

- **Normative Authority**: `REQUIREMENTS.md` is the only product authority. Implementation is evidence, not authority.
- **Abstract Layer**: `REQUIREMENTS.md` must avoid all implementation details (frameworks, file paths, etc.) and pass the "overnight-loss test."
- **Freeze Status**: All product-changing work (new features, refactors, migrations) is frozen until the authority is established.
- **Fail-Fast**: The requirements must enforce loud, visible failures for invalid states.

## Prerequisites

- **Access**: Full read access to the repository and allowed skill directories.
- **Tools**: `iwe` for memory management, standard shell tools for inspection.

## Scope

- **Included**: All user-facing behaviors, state ownership, external contracts, and failure semantics.
- **Excluded**: Internal implementation narratives, abandoned historical choices (except in Ledger), and migration roadmaps.

## Phases

### Phase 0: Declaration and Freeze

**Goal**: Formally halt product-changing work and announce the freeze.

- **Task 0.1**: Update `AGENTS.md` to declare the requirements freeze.
  - **Location**: `AGENTS.md`
  - **Description**: Add a prominent notice at the top of `AGENTS.md` stating that a requirements freeze is in effect and work is restricted to extraction/maintenance.
  - **Acceptance criteria**: `AGENTS.md` reflects the freeze status.
  - **Validation**: Read `AGENTS.md`.

- **Task 0.2**: Initialize `REQUIREMENTS-LEDGER.md`.
  - **Location**: `REQUIREMENTS-LEDGER.md`
  - **Description**: Create the evidence ledger and record current artifacts (TODO.md, AGENTS.md, docs/) as evidence only.
  - **Acceptance criteria**: Ledger exists and lists the status of primary documents.
  - **Validation**: Read `REQUIREMENTS-LEDGER.md`.

### Phase 1: Evidence Classification and Extraction

**Goal**: Catalog existing claims and classify them according to the skill taxonomy.

- **Task 1.1**: Inspect `AGENTS.md` and `docs/` for product requirements.
  - **Location**: `REQUIREMENTS-LEDGER.md`
  - **Description**: Group claims from `AGENTS.md` into categories: requirement, design decision, anti-requirement, etc.
  - **Acceptance criteria**: Ledger populated with classified evidence.
  - **Validation**: Review ledger content.

- **Task 1.2**: Audit codebase for "User-Surprise" patterns.
  - **Location**: `REQUIREMENTS-LEDGER.md`
  - **Description**: Search for `unwrap_or`, `catch`, `|| true`, etc., to identify hidden failures or silent fallbacks to be forbidden.
  - **Acceptance criteria**: Categories identified in ledger.
  - **Validation**: `grep` results recorded in ledger.

### Phase 2: Abstract Requirements Authority (`REQUIREMENTS.md`)

**Goal**: Create the normative abstract product specification.

- **Task 2.1**: Draft `REQUIREMENTS.md` Sections 0-2 (Authority, Definition, Non-goals).
  - **Location**: `REQUIREMENTS.md`
  - **Description**: Establish the authority statement and define the product mission (browser-based editor with live Pandoc preview).
  - **Acceptance criteria**: Sections present and abstract.
  - **Validation**: Verify no implementation nouns are used.

- **Task 2.2**: Draft Section 3: User-facing requirements.
  - **Location**: `REQUIREMENTS.md`
  - **Description**: Extract outcomes like "Save current document," "Live preview," "Diagram generation integration."
  - **Acceptance criteria**: Each REQ-XXX has the required structure (Outcome, Owner, Oracle, etc.).
  - **Validation**: Check schema compliance.

- **Task 2.3**: Draft Section 4-6: Ownership, State Model, External Contracts.
  - **Location**: `REQUIREMENTS.md`
  - **Description**: Define `currentDocument`, `bufferStatus`, `renderStatus`. Assign ownership (Textarea owns text, App owns file identity).
  - **Acceptance criteria**: Ownership matrix and state variables clearly defined.
  - **Validation**: No dual ownership.

- **Task 2.4**: Draft Section 9: User-Surprise and Forbidden Behavior Inventory.
  - **Location**: `REQUIREMENTS.md`
  - **Description**: Populate the inventory based on Phase 1 audits (no silent fallbacks, no hidden failures).
  - **Acceptance criteria**: Mandatory table and categories present.
  - **Validation**: Matches `requirements-freeze-extraction` requirements.

- **Task 2.5**: Draft Section 10-11: Abstract State Machine and Happy Paths.
  - **Location**: `REQUIREMENTS.md`
  - **Description**: Define transitions for Open, Edit, Save, Render.
  - **Acceptance criteria**: State transitions cover major workflows.
  - **Validation**: Verify consistency with State Model.

### Phase 3: Design Commitments Authority (`DESIGN-COMMITMENTS.md`)

**Goal**: Record the concrete technical choices for the current implementation.

- **Task 3.1**: Draft `DESIGN-COMMITMENTS.md`.
  - **Location**: `DESIGN-COMMITMENTS.md`
  - **Description**: Record Tauri, Rust, React, Pandoc-centricity, and filesystem conventions.
  - **Acceptance criteria**: Document exists and reflects current tech stack commitments.
  - **Validation**: Read `DESIGN-COMMITMENTS.md`.

### Phase 4: Finalization and Cleanup

**Goal**: Transition to the new authority and update existing trackers.

- **Task 4.1**: Update `TODO.md` as non-normative.
  - **Location**: `TODO.md`
  - **Description**: Add a notice that `TODO.md` is a non-normative task tracker and all product goals must derive from `REQUIREMENTS.md`.
  - **Acceptance criteria**: Notice present.
  - **Validation**: Read `TODO.md`.

## System-Level Validation

- **Overnight-Loss Test**: Review `REQUIREMENTS.md` to ensure it contains zero mentions of "Tauri," "Rust," "React," "JSON," ".tsx," etc.
- **Current-App Reconstruction Test**: Review both `REQUIREMENTS.md` and `DESIGN-COMMITMENTS.md` to ensure they provide enough info to rebuild the current app's behavior.

## Risks / Rollback

- **Risk**: Over-extraction of implementation detail into the abstract layer.
  - **Mitigation**: Constant "overnight-loss" check during writing.
- **Risk**: Missing critical existing constraints.
  - **Mitigation**: Cross-reference with `AGENTS.md` and `TODO.md` items before finalizing.
- **Rollback**: Delete the newly created `.md` files and remove the freeze notice from `AGENTS.md`.

## Stop Rules

- Do not proceed with Task 2.1 until Phase 1 (Ledger) has captured the majority of current claims.

## Execution Progress

### Prerequisites

- [x] Access requirements met
- [x] Environment configured
- [x] External dependencies resolved

### Phase 0: Declaration and Freeze

- [x] Task 0.1: Declare requirements freeze in `AGENTS.md`
- [x] Task 0.2: Initialize `REQUIREMENTS-LEDGER.md`

### Phase 1: Evidence Classification and Extraction

- [x] Task 1.1: Inspect `AGENTS.md` and `docs/` for requirements
- [x] Task 1.2: Audit codebase for "User-Surprise" patterns

### Phase 2: Abstract Requirements Authority

- [x] Task 2.1: Draft Sections 0-2 (Authority, Definition, Non-goals)
- [x] Task 2.2: Draft Section 3 (User-facing requirements)
- [x] Task 2.3: Draft Sections 4-6 (Ownership, State, Contracts)
- [x] Task 2.4: Draft Section 9 (User-Surprise Inventory)
- [x] Task 2.5: Draft Sections 10-11 (State Machine, Happy Paths)

### Phase 3: Design Commitments Authority

- [x] Task 3.1: Draft `DESIGN-COMMITMENTS.md`

### Phase 4: Finalization

- [x] Task 4.1: Update `TODO.md` notice

### Quality Gates

- [x] Completeness verified
- [x] Actionability verified
- [x] Design sensibility verified
- [x] Test quality verified (N/A for doc extraction)
