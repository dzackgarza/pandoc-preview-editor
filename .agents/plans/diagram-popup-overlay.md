# Feature: Diagram Popup Overlay

## User Outcome

Diagrams (Mermaid, PlantUML, Graphviz, images, etc.)
rendered in the preview iframe can be opened in a draggable, zoomable popup overlay via
Ctrl+click or a hover button — same as
[gitcpy/obsidian-diagram-popup](https://github.com/gitcpy/obsidian-diagram-popup).

## What the Existing Plugin Does

- Detects diagram elements in rendered markdown by configurable CSS class selectors
  (default: `.mermaid`)
- On hover, shows an "Open Popup" button over the diagram
- On click or Ctrl+click, clones the diagram into a full-viewport overlay
- Popup supports: pan/drag, zoom via mouse wheel, touch gestures, arrow buttons, close
- Configurable: background color/alpha/blur, initial zoom ratio, move step

## Integration for pandoc-preview

Because the app renders previews in an iframe, there are two approaches:

1. **Inject into the iframe** — the popup script runs inside the preview iframe's
   document, finds diagram elements, and creates the overlay within the iframe.
2. **Host-page overlay** — the app's host page communicates with the iframe via
   postMessage to extract diagram content, then renders the popup overlay on the host
   page (avoids the iframe viewport boundary).

The Obsidian plugin's `styles.css` and the popup/zoom/drag logic are the reference.
Adapt the CSS class selectors to match this app's rendering output (e.g., `.mermaid`
produced by pandoc's `--to html` with the `--mermaid`/`--mathjax` flags, or whatever the
configured renderer emits).
