# LLM Proof Loop WTF Patterns

Use this memory before accepting agent-produced tests, architecture claims, or remediation plans in `pandoc-preview`.

The recurring failure mode is proof laundering: the agent adds artifacts that make a claim look verified while the app still owns a different runtime boundary.

## Triggers

- **The Narrative Cloak (xvfb)**: Using virtual displays (xvfb) or hidden buffers to mask focus-stealing GUI windows and orphaned process trees instead of fixing the lifecycle. Lying about "headless environments" to justify hiding evidence from the user. See `.agents/audits/NARRATIVE-LAUNDERING-CASE-STUDY.md`.
- **Dynamic Resource Evasion**: Generating randomized socket paths or identifiers specifically to bypass collision errors from previous runs that failed to clean up. This is "patch-on-slop" that leaves zombie processes leaking background resources.
- **Enterprise Security Theater**: Adding build flags, feature gates, or complexity to a bespoke app to satisfy imagined "production standards" or prevent "backdoors" that don't exist in a single-user companion tool.
- **Documentation Laundering**: Writing "sophisticated" architectural justifications (e.g., "epistemic isolation," "CI-parity") for what is actually a cowardly workaround for a functional failure.
- A test claims Tauri, renderer, filesystem, save, or recovery coverage while using browser mocks, fake paths, static text assertions, or synthetic IPC.
- A plan asks for exact round-trip behavior, but tests compare derived summaries, unordered sets, booleans, or other lossy projections.
- A review criticizes regex or brittle parsing, and the follow-up replaces the regex with a hand scanner or Rust postprocessor instead of assigning the behavior to the renderer command, Pandoc filter chain, protocol, or existing browser/runtime mechanism.
- Documentation declares a new architecture while old commands, UI state, config fields, or runtime flows still implement the previous architecture.
- Documentation claims a slop pattern is fixed only because the test, recipe, or report was renamed.
- Fail-fast language appears in docs while config or command code still uses defaults, `unwrap_or_default`, warnings, or success-shaped fallback values.
- A dependency is added with a different package manager than the repo's `just` recipes use.

## Required Response

Treat these as evidence that the proof loop is untrustworthy, not as isolated bugs. Reconstruct the likely agent move:

- What user-level outcome was requested?
- What artifact did the agent create to look responsive?
- What real boundary does the repository actually need proved?
- What trivial alternative would prove the boundary directly?

Then triage by restoring the canonical proof surface before touching feature code. Do not add more mock tests, prose, status labels, or triage reports until the repo's `just` path proves the real app boundary it claims to prove.

## Verification

A future fix is acceptable only when:

- `just test` exercises the same runtime boundary named by the test or plan.
- Command round-trip checks preserve shell argv order, quoting semantics, and real renderer invocation behavior.
- HTML and asset behavior is owned by the renderer command, Pandoc filter chain, native browser/Tauri mechanism, or documented protocol instead of app-owned Rust HTML mutation.
- Architecture docs and runtime code agree on one recovery model.
- Config errors fail visibly instead of silently replacing user state with defaults.
