# decisions/tikz-generation-integration

---
status: accepted
date: 2026-06-05
---

# Deep Integration with TikZ Generation Tools

## User Outcome
The app provides deep, tight integration with standard TikZ generation tools (e.g., FreeTikZ, quiverapp) to facilitate automatically populating markdown files with TikZ code. This integration is a core part of the app's bespoke identity.

## Distinct from Rendering
This feature facilitates TikZ *generation* and *injection* into the source document. It is fundamentally distinct from TikZ *rendering*, which remains strictly server-side via Pandoc (as mandated in `AGENTS.md`).

## Abstract Requirements
- The app must provide one-button access to external TikZ generation tools.
- The workflow must allow for the seamless extraction of generated code from these tools.
- Extracted code must be injected directly into the active document at the cursor position.
- The integration should minimize context-switching friction while ensuring that the generated code respects the app's server-side rendering pipeline (e.g., using fenced code blocks that the existing TikZ filters handle).

## Stability Basis
Tools like FreeTikZ and quiverapp are considered extremely standard and stable in the mathematical research ecosystem (stable for 4-5+ years). Deep integration with these specific tools is a deliberate product choice.
