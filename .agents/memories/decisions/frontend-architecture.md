# decisions/frontend-architecture

---
status: accepted
date: 2026-06-05
---

# Frontend Architecture

## User Outcome
A responsive, maintainable UI where state changes are predictable and re-renders are optimized. The app remains extensible without the complexity of "god objects."

## Abstract Requirements
- **Orchestration Boundary**: `App.tsx` acts exclusively as the high-level orchestration boundary. It coordinates between major UI sections but does not own the implementation details of every feature.
- **Domain-Specific Hooks**: State and logic must be factored into domain-specific custom hooks (e.g., `useFileManager`, `useRenderer`, `usePlugins`). This reduces the "blast-radius" of edits and prevents unrelated state changes from triggering global re-renders.
- **Declarative Patterns**: UI logic must follow React's declarative model. Direct DOM manipulation (especially into iframes) is a layer violation and must be replaced with data-driven interfaces.
- **Standard Utilities**: Feature-agnostic tasks (e.g., HTML escaping) must use mature libraries or shared, tested utilities rather than inline bespoke reimplementations.

## Stability Basis
Decoupling state from the root component ensures that as the application grows (e.g., adding Zotero, Diagrams, etc.), the core interface remains performant and easier for agents to audit without massive context-window pressure.
