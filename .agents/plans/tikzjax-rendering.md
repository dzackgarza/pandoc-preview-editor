# Retired Feature: TikZJax Rendering in Preview

## Status

Retired.
Do not implement this plan.

AGENTS.md forbids in-browser TikZ rendering.
TikZ diagrams must render to SVG through server-side Pandoc, using user-controlled templates, filters, macros, and style files under the configured Pandoc asset directories.

## Replacement Outcome

Markdown containing TikZ should render as static SVG in the preview through the same renderer command the app already owns.
The proof belongs in the Tauri Playwright suite: enter or open a real document, run the configured renderer, and assert that preview content contains the expected SVG output without TikZJax or client-side script injection.
