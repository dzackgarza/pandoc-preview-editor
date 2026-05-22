# Feature: TikZJax Rendering in Preview

## User Outcome

`` ```tikz `` code blocks in markdown render as SVG diagrams in the preview, without a
LaTeX toolchain on the server.
Same as the [Obsidian TikZJax plugin](https://github.com/artisticat1/obsidian-tikzjax).

## Integration

The code already exists.
Two pieces:

1. **Include `@jhuix/tikzjax`** as a dependency.
   It compiles TikZ → SVG in-browser via WebAssembly.
   Import and call `TikZJax.tex2svg(source)`.
2. **Run it in the preview iframe** — after pandoc renders the HTML, pass any
   `` ```tikz `` code blocks through `tex2svg()` and replace them with the returned SVG.

The Obsidian plugin's `main.ts` shows the pattern:
- Register a postprocessor for `` ```tikz `` blocks
- Tidy the source (strip `&nbsp;`, trim lines, remove empties)
- Call `TikZJax.tex2svg(source)` → get SVG
- Post-process (dark mode color inversion, SVGO optimization)
- Replace the code block element with the SVG

For this app, the same logic runs as a script in the pandoc HTML template (after the
preview loads). Or it can be injected into the iframe from the app's render handler.
