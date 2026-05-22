# Plan: Deprioritized Active Cards

## Goal

- Current defect/state: `TODO.md` still has one outstanding bucket for deprioritized
  active cards, but there is no single plan that explains how those cards should be
  handled as a set or what would justify reactivating any of them.
- Target state: the repo has one explicit plan for managing the deprioritized-card set:
  keep the cards out of the near-term implementation queue, evaluate them by user
  outcome and ownership, and only reactivate one when it survives the feature-evaluation
  framework.
- Why this matters: without a single plan, the card bucket is easy to treat as vague
  backlog sludge. The repo needs a continuable rule for whether these are archived,
  retained as references, split further, or promoted back into active work.

## Constraints

- Required:
  - Use `AGENTS.md`, `.agents/plans/FEATURE-EVALUATION-FRAMEWORK.md`, and
    `docs/feature-evaluation-philosophy.md` as the canonical decision rules.
  - Evaluate each card by user outcome and ownership, not by proximity to existing UI.
  - Preserve useful research notes without keeping obviated work in the active queue.
- Forbidden:
  - Do not silently promote a deprioritized card into implementation without a fresh
    ownership check.
  - Do not keep cards active if Firenvim, nvim, the textarea, config, or the configured
    renderer already owns the full user outcome.
  - Do not convert speculative research into nearby app work just because some adjacent
    app surface exists.
- Approval gates:
  - If any card appears product-critical after re-evaluation, stop and ask whether it
    should move from the deprioritized bucket into the main TODO as its own item.

## Prerequisites

- Confirm the current deprioritized set from `TODO.md`.
- Review the existing per-card research notes:
  - `.agents/plans/criticmarkup-gui-interaction.md`
  - `.agents/plans/agent-chat-integration.md`
  - `.agents/plans/tikzjax-rendering.md`
  - `.agents/plans/settings-dropdown-pandoc-command.md`
- Confirm the current shipped architecture and ownership rules from `AGENTS.md`.

## Scope

- Included targets:
  - CriticMarkup GUI
  - Agent chat
  - TikZJax rendering
  - Renderer/filter settings UI
  - Promotion/archive criteria for the deprioritized bucket as a whole
- Excluded targets:
  - Implementing any of these cards now
  - Rewriting unrelated feature plans
  - Expanding the bucket with new speculative ideas during this pass

## Phase 0: Inventory and Ownership Audit

Goal: determine whether each deprioritized card is still a real app-owned outcome.

### Task 0.1: Audit CriticMarkup GUI ownership

- Location: `.agents/plans/criticmarkup-gui-interaction.md`, repo architecture docs
- Description: decide whether the desired user outcome is app-owned preview behavior,
  editor behavior owned by Firenvim/nvim, or renderer/wrapper behavior.
- Dependencies: prerequisites complete
- Acceptance criteria: CriticMarkup GUI is classified as active-candidate, deferred, or
  obviated with a short rationale.
- Validation: written audit against the feature-evaluation framework.

### Task 0.2: Audit agent chat ownership

- Location: `.agents/plans/agent-chat-integration.md`, repo architecture docs
- Description: decide whether agent chat still solves a current app-owned user outcome or
  remains speculative and external to the shipped editor/preview model.
- Dependencies: prerequisites complete
- Acceptance criteria: agent chat is classified with an explicit rationale and activation
  gate.
- Validation: written audit against the feature-evaluation framework.

### Task 0.3: Audit TikZJax rendering ownership

- Location: `.agents/plans/tikzjax-rendering.md`, renderer-related docs/plans
- Description: decide whether TikZJax is an app-owned preview enhancement or an
  unnecessary second renderer path next to the configured renderer plus centralized
  filters.
- Dependencies: prerequisites complete
- Acceptance criteria: TikZJax is classified with an explicit rationale and activation
  gate.
- Validation: written audit against renderer-ownership rules.

### Task 0.4: Audit renderer/filter settings UI ownership

- Location: `.agents/plans/settings-dropdown-pandoc-command.md`, `AGENTS.md`
- Description: decide whether any remaining user outcome survives the explicit repo rule
  against settings UI for renderer-specific arguments.
- Dependencies: prerequisites complete
- Acceptance criteria: the settings card is either deleted as obviated or narrowed to a
  read-only display outcome if one still exists.
- Validation: written audit against the hard-boundary rules in `AGENTS.md`.

## Phase 1: Bucket Resolution

Goal: give each deprioritized card a stable status and next trigger.

### Task 1.1: Record per-card disposition

- Location: `TODO.md` and `.agents/plans/deprioritized-active-cards.md`
- Description: for each audited card, record one of:
  - `obviated`
  - `deprioritized but viable`
  - `promote to active TODO item`
- Dependencies: Phase 0 audits
- Acceptance criteria: every card has a disposition plus one-sentence rationale.
- Validation: inventory review against the current bucket contents.

### Task 1.2: Define promotion triggers

- Location: `.agents/plans/deprioritized-active-cards.md`
- Description: define what concrete change would justify promoting a card, such as a new
  product decision, a missing app-owned outcome, or a confirmed renderer-agnostic design
  that survives the framework.
- Dependencies: Task 1.1
- Acceptance criteria: each non-obviated card has a concrete reactivation trigger.
- Validation: plan review for specificity and falsifiability.

### Task 1.3: Define archival handling

- Location: `.agents/plans/deprioritized-active-cards.md`
- Description: specify whether obviated cards stay only as historical research files,
  move out of the TODO bucket entirely, or remain referenced under an archive section.
- Dependencies: Task 1.1
- Acceptance criteria: the repo has a consistent rule for keeping or removing obviated
  cards from active planning surfaces.
- Validation: review against the rule that obviated cards should not remain active.

## Phase 2: Verification and Cleanup

Goal: make the deprioritized-card policy continuable for future planning passes.

### Task 2.1: Verify TODO alignment

- Location: `TODO.md`
- Description: ensure the TODO bucket wording matches the audited dispositions and does
  not imply hidden active work for cards that should stay archived or obviated.
- Dependencies: Phase 1 complete
- Acceptance criteria: TODO wording accurately reflects the bucket’s real meaning.
- Validation: manual review of TODO against the audited card table.

### Task 2.2: Verify cross-plan references

- Location: `.agents/plans/deprioritized-active-cards.md` and the four per-card plan files
- Description: add or verify references so a future agent can move from the bucket plan
  to the per-card research notes without rediscovering filenames.
- Dependencies: Phase 1 complete
- Acceptance criteria: the bucket plan points to all relevant per-card materials.
- Validation: file inspection.

## System-Level Validation

- End-to-end checks:
  - Every card in the deprioritized TODO bucket has an explicit disposition.
  - Obviated cards are not implicitly treated as near-term work.
  - Viable-but-deferred cards have concrete promotion triggers.
  - The bucket remains consistent with the repo’s ownership rules.
- Real-use smoke checks:
  - CriticMarkup GUI classification
  - Agent chat classification
  - TikZJax classification
  - Renderer/filter settings classification

## Risks / Rollback

- Risks:
  - Keeping vague bucket language may continue to invite accidental scope creep.
  - Deleting a card too aggressively could lose useful research.
  - Promoting a card without a fresh ownership check could violate repo boundaries.
- Mitigations:
  - Require explicit per-card disposition and trigger language.
  - Preserve research files even when a card is obviated.
  - Route reactivation through the feature-evaluation framework.
- Rollback path:
  - Revert TODO wording and bucket-plan changes while preserving existing per-card
    research files.

## Stop Rules

- Do not implement any deprioritized card as part of this planning task.
- Do not keep an obviated card in the active queue without a written exception.
- Do not promote a card unless it survives a fresh ownership audit.
- Do not expand the bucket with new speculative work during this pass.

## Execution Progress

### Prerequisites

- [ ] Confirm current deprioritized-card set
- [ ] Review all existing per-card research notes

### Phase 0: Inventory and Ownership Audit

- [ ] Task 0.1: Audit CriticMarkup GUI ownership
- [ ] Task 0.2: Audit agent chat ownership
- [ ] Task 0.3: Audit TikZJax rendering ownership
- [ ] Task 0.4: Audit renderer/filter settings UI ownership

### Phase 1: Bucket Resolution

- [ ] Task 1.1: Record per-card disposition
- [ ] Task 1.2: Define promotion triggers
- [ ] Task 1.3: Define archival handling

### Phase 2: Verification and Cleanup

- [ ] Task 2.1: Verify TODO alignment
- [ ] Task 2.2: Verify cross-plan references

### System-Level Validation

- [ ] End-to-end checks pass
- [ ] Real-use smoke checks pass

### Quality Gates

- [ ] Completeness verified
- [ ] Actionability verified
- [ ] Design sensibility verified
- [ ] Test quality verified
