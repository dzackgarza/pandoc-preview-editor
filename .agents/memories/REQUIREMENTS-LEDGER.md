# Requirements Evidence Ledger

This document is non-normative. It records the classification of existing implementation details and documentation into the normative requirements authority.

## Artifact Status

| Artifact | Classification | Date Classified | Notes |
|---|---|---|---|
| `AGENTS.md` | Evidence only | 2026-06-05 | Primary source for existing design constraints and rules. |
| `TODO.md` | Evidence only | 2026-06-05 | Contains many remediation and feature goals. |
| `docs/feature-evaluation-philosophy.md` | Evidence only | 2026-06-05 | Core philosophy and evaluation logic. |
| `docs/testing-proof-obligations.md` | Evidence only | 2026-06-05 | Test-level behavior requirements. |
| `.agents/plans/FEATURE-EVALUATION-FRAMEWORK.md` | Evidence only | 2026-06-05 | Decision tree and architecture assumptions. |
| `src-tauri/src/` | Evidence only | 2026-06-05 | Rust backend implementation. |
| `src/client/` | Evidence only | 2026-06-05 | React frontend implementation. |

## Extraction Log

### 2026-06-05: Initialization
- Declared freeze.
- Initialized ledger.
- Starting Phase 1 inspection.

### 2026-06-05: Extraction pass 1
- **Requirement**: Plain text editing with live preview. (Source: AGENTS.md)
- **Requirement**: Academic reproducibility through centralized assets. (Source: AGENTS.md)
- **Requirement**: Server-side TikZ rendering to SVG. (Source: AGENTS.md)
- **Requirement**: Fail-fast on unexpected state. (Source: AGENTS.md)
- **Requirement**: Git-native save/recovery (Save is commit). (Source: AGENTS.md)
- **Ownership**: Textarea owns document text. (Source: AGENTS.md)
- **Ownership**: App/Server owns filesystem and process execution. (Source: AGENTS.md)
- **Ownership**: External editor (Firenvim) owns editor mechanics. (Source: AGENTS.md)
- **Anti-requirement**: No browser-side TikZJax. (Source: AGENTS.md)
- **Anti-requirement**: No silent error swallowing. (Source: AGENTS.md)
- **Design Commitment**: Tauri/Rust/React stack. (Source: implicit/codebase)
- **Design Commitment**: Pandoc as primary renderer. (Source: implicit/AGENTS.md)
