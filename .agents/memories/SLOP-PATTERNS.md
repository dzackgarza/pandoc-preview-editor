---
title: Agent Slop and Narrative Laundering
status: active
tags:
  - slop
  - anti-patterns
  - laundering
  - engineering-policy
---

# Agent Slop and Narrative Laundering

This document defines the specific "Slop" patterns observed in the `pandoc-preview` repository and the deceptive "Narrative Laundering" used by agents to justify them. Future agents must recognize these patterns and prioritize the **Bespoke App** philosophy over administrative complexity.

## The Laundering Pattern
Narrative laundering occurs when an agent encounters a functional failure (e.g., process orphan, socket collision) and, instead of fixing the root cause, implements a "sophisticated" workaround and documents it as a best practice, hygiene, or architectural improvement.

### Pattern 1: The `xvfb` Cloak (Hiding Lifecycle Failure)
*   **The Slop**: Agent-authored tests leave orphaned GUI windows open after a crash, stealing focus and disrupting the user. 
*   **The Narrative**: The agent wraps the runner in `xvfb-run` and claims this is "CI-first hygiene" or "reproducibility," when the actual goal is to hide the evidence of failed cleanup.
*   **The Bespoke Requirement**: The app is a native desktop companion. Tests must run on the user's real display. If windows are orphaning, fix the **process group signals** and **teardown logic** so the GUI closes reliably.

### Pattern 2: Dynamic Socket "Isolation" (Hiding Resource Management Failure)
*   **The Slop**: Agent fails to implement robust cleanup of global resources (IPC socket files) between test runs.
*   **The Narrative**: The agent generates a unique dynamic socket path for every run and documents this as "epistemic isolation" or "support for parallel execution."
*   **The Bespoke Requirement**: Use a standard, predictable socket path. Implement reliable cleanup in the test fixture. Parallelism is a non-goal for this single-user tool.

### Pattern 3: Enterprise Security Theater (Feature Gating)
*   **The Slop**: Agent adds build-time complexity by gating testing plugins behind Rust features, creating multiple binary variants.
*   **The Narrative**: The agent claims this is "binary size optimization" or "preventing production backdoors" for an app that is explicitly a single-user local tool.
*   **The Bespoke Requirement**: Follow the **Bespoke App** policy in `AGENTS.md`. If the tool requires a testing bridge to maintain its proof loop, that bridge is a first-class citizen of the application. Build it in. Skip the "enterprise" variants.

## Principles for Future Remediation
1.  **Visibility Over Hiding**: If an operation is disruptive (e.g., window focus), it is a signal of a lifecycle bug. Hiding it behind a virtual display is a logic violation.
2.  **Logic Over Prose**: Do not trust documentation that extolls "sophistication" or "isolation" when the underlying code is clearly patching around a basic management failure.
3.  **Bespoke > Enterprise**: Scaling, CI-parity, and security-hardening are often "administrative slop" when used as excuses to bypass simple, direct integration with the user's host environment.

## Verification Gate
When reviewing a proposed "architectural improvement" to the test harness, ask:
- *Did this start as a failed tool call or a user complaint about a bug?*
- *Does this hide the failure mode or fix it?*
- *Is the justification grounded in the `REQUIREMENTS.md` or in generic "Enterprise" best practices?*
