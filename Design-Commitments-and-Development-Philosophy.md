# Design Commitments and Development Philosophy

## Purpose

This document records how future implementation work must preserve the character of the app. It is not a generic engineering checklist. It exists to prevent agent-driven regression, feature laundering, and slop.

## Bespoke environment

The target environment is a known Linux workstation controlled by the user.

Do not design for:

- other operating systems;
- multiple users;
- remote collaboration;
- hosted deployment;
- horizontal scaling;
- malicious documents;
- adversarial local users;
- hardened browser isolation.

The app is allowed to depend on the exact tools it uses. Missing tools are configuration failures, not opportunities for fallback architecture.

## Correct threat model

The primary threat is not an attacker.

The primary threat is future development that makes the app worse while appearing productive.

Examples:

- tests that pass without proving behaviour;
- mocks that replace real app boundaries;
- silent fallbacks;
- hidden defaults;
- success-shaped error values;
- deleted slop that hides the unresolved problem;
- broad catch blocks;
- conditional imports;
- compatibility shims after a replacement decision;
- feature flags preserving abandoned paths;
- UI changes that obscure the save/Git/recovery model;
- renderer-specific config keys that fork the command string source of truth;
- app code absorbing responsibilities that belong to Pandoc filters or templates.

## Dependency policy

Dependencies are good when they are mature and solve the problem.

Use Pandoc for document rendering. Use Git for versioning and rollback. Use CodeMirror or Firenvim for editing. Use mature crates and libraries for solved infrastructure tasks. Use the operating system for ordinary file semantics.

Do not reimplement mature tools inside the app.

Do not classify dependencies as liabilities merely because they are external.

Do not add try-import or conditional-import paths. Declare required dependencies and fail if absent.

## Fail-fast policy

Unexpected state must crash promptly and visibly.

No silent degradation.

No fallback defaults at runtime.

No empty-list fallback.

No falsey error encoding.

No replacement of missing configuration with guessed values.

No substitution of mock output for real tool output.

If a dependency or configured asset is missing, fail with a visible diagnostic.

## Bridge-burning policy

When feature A is replaced by feature B, delete A entirely.

Do not keep:

- deprecated annotations;
- compatibility shims;
- fallback paths;
- feature flags;
- old code branches;
- “temporary” alternate implementations.

A replacement that leaves the old implementation available has not replaced it.

## Ownership boundaries

`App.tsx` is orchestration only. It should not accumulate feature-level state or domain logic.

Domain-specific state belongs in custom hooks or backend modules with clear ownership.

The app owns document identity and workflow state.

Pandoc owns rendering.

Templates own HTML structure, style hooks, and client-side content-layer behaviour.

Filters own semantic transformations of document content.

Plugins own external export or tool invocation.

Git owns version history and recovery.

External diagram tools own diagram editing.

## Renderer command ownership

The raw `render_command` string is the source of truth.

Structured settings controls parse and reconstruct that command. They do not define an independent renderer model.

The app must not add renderer-specific config keys as a second source of truth.

## Pandoc asset ownership

Templates and filters are user-editable data in `~/.pandoc/`.

The app may scan these directories and expose controls for selecting assets.

The app may validate that selected assets exist.

The app must not embed template contents in source code.

The app must not construct templates through string manipulation.

## Error semantics

IPC must make success and failure unambiguous.

`Ok` means success.

Failures are structured errors.

Render duration is diagnostics only.

A nonzero renderer exit is failure.

A nonzero plugin exit is failure.

No success-shaped failures.

No suppressed stderr.

No caught exceptions that disappear.

## Code reading and editing

Use Serena as the primary interface for code reading, search, and editing when agent tooling is available.

Do not use local rummaging as a substitute for repository-aware code navigation.

## Anti-slop review standard

A change is not accepted merely because it adds files, docs, tests, or artifacts.

A change is accepted only if it preserves or improves the actual app contract.

Every nontrivial change must answer:

1. What user-visible or recovery-critical behaviour changes?
2. Which layer owns it?
3. Which existing path is deleted or preserved?
4. What real proof boundary discharges it?
5. Could the implementation be faking success?
6. Does it introduce a fallback, default, compatibility branch, or hidden alternate path?
