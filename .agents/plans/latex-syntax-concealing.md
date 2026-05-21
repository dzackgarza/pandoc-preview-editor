# High-Performance Cursor-Aware Inline Math SVG Rendering and Syntax Concealing

Boilerplate markup noise (like `:::`, `\hfill`, `\begin{...}`, and math delimiters `$`, `$$`) is visually concealed and replaced with clean rendered SVG graphics or custom symbols inside the editor workspace. This plan outlines the exact high-performance, cursor-aware inline rendering architecture for both CodeMirror 6 and Neovim (including Firenvim context).

## User Review Required

> [!IMPORTANT]
> The rendering of inline math in CodeMirror 6 requires a lightweight compilation service (like a local KaTeX instance or a fast backend Typst SVG compiler). We will leverage KaTeX running in the client context to compile LaTeX math equations to SVGs synchronously for instant render.
> For Neovim, high-performance graphical rendering requires a terminal emulator that supports the Kitty graphics protocol (e.g. Kitty, Ghostty, WezTerm) and uses combining diacritic placeholders to map cell positions to the uploaded image ID.

## Proposed Changes

### Editor Components

#### [MODIFY] [latex-syntax-concealing.md](file:///home/dzack/gitclones/pandoc-preview/.agents/plans/latex-syntax-concealing.md)

This file defines the complete architectural design and replaces the previous text-only concealing placeholder.

### CodeMirror 6 Architecture

We implement a highly optimized `ViewPlugin` that tracks the cursor position and renders `Decoration.replace` widgets containing baseline-aligned SVG nodes:

* **Inline SVG Compilation**: When a math block (e.g. `$ ... $` or `$$ ... $$`) is detected in the viewport, the source formula text is compiled via KaTeX to an SVG string.
* **Precise Baseline Alignment**:
  * We extract the baseline alignment metrics (height and depth bounds) from KaTeX's output or dynamic CSS offsets.
  * In the custom `WidgetType`, we set `vertical-align` properties (e.g., `vertical-align: -0.2ex` or dynamic em/ex values) on the wrapper `span` element to align the SVG perfectly with the text baseline of the line.
* **Fine-Grained Cursor Expansion**:
  * The view plugin listens to cursor position updates (`view.state.selection.main.head`).
  * If the cursor coordinate falls inside a math node's `[from, to]` range, we omit the `Decoration.replace` decoration for *only* that specific node.
  * This triggers a clean local expansion, revealing the raw LaTeX text for inline editing under the cursor while leaving all other math expressions on the same line fully rendered.
* **Viewport-Only Parsing**: We restrict syntax tree iteration strictly to the active `visibleRanges` (the visible viewport plus a small scroll buffer) to guarantee high-performance editing in large files.

Here is the CodeMirror 6 ViewPlugin design:

```typescript
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import katex from "katex";

class MathSVGWidget extends WidgetType {
  constructor(readonly formula: string, readonly displayMode: boolean) {
    super();
  }

  eq(other: MathSVGWidget) {
    return other.formula === this.formula && other.displayMode === this.displayMode;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-math-render";
    try {
      // Render to SVG or HTML via KaTeX
      const htmlStr = katex.renderToString(this.formula, {
        displayMode: this.displayMode,
        throwOnError: false,
        output: "htmlAndMathml"
      });
      span.innerHTML = htmlStr;
      
      // Inline styling to guarantee baseline alignment
      const katexElement = span.querySelector(".katex");
      if (katexElement) {
        (katexElement as HTMLElement).style.display = "inline-block";
        (katexElement as HTMLElement).style.verticalAlign = "middle";
      }
    } catch (err) {
      span.textContent = this.formula;
      span.className = "cm-math-render-error";
    }
    return span;
  }
}

class ConcealWidget extends WidgetType {
  constructor(readonly replacement: string) {
    super();
  }

  eq(other: ConcealWidget) {
    return other.replacement === this.replacement;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-conceal";
    span.textContent = this.replacement;
    return span;
  }
}

export const mathConcealPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.computeDecos(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.computeDecos(update.view);
      }
    }

    computeDecos(view: EditorView): DecorationSet {
      const widgets = [];
      const cursorHead = view.state.selection.main.head;
      const state = view.state;

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from,
          to,
          enter: (node) => {
            // Match math expressions
            if (node.name === "InlineMath" || node.name === "BlockMath") {
              const nodeFrom = node.from;
              const nodeTo = node.to;
              const isCursorInside = cursorHead >= nodeFrom && cursorHead <= nodeTo;

              if (!isCursorInside) {
                const text = state.sliceDoc(nodeFrom, nodeTo);
                // Strip the math delimiters ($ or $$)
                const isBlock = node.name === "BlockMath";
                const delimiterLength = isBlock ? 2 : 1;
                const formula = text.substring(delimiterLength, text.length - delimiterLength);

                const deco = Decoration.replace({
                  widget: new MathSVGWidget(formula, isBlock),
                  inclusive: false,
                });
                widgets.push(deco.range(nodeFrom, nodeTo));
              }
            }

            // Match syntax boilerplate (delimiters, blocks, tags)
            if (node.name === "LaTeXDelimiter" || node.name === "PandocTag") {
              const nodeFrom = node.from;
              const nodeTo = node.to;
              const isCursorInside = cursorHead >= nodeFrom && cursorHead <= nodeTo;

              if (!isCursorInside) {
                const deco = Decoration.replace({
                  widget: new ConcealWidget("―"),
                  inclusive: false,
                });
                widgets.push(deco.range(nodeFrom, nodeTo));
              }
            }
          },
        });
      }
      return Decoration.set(widgets, true);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
```

### Neovim (Firenvim) Architecture

To match the performance and premium characteristics of `math-conceal.nvim` and `typst-concealer`, Neovim concealing utilizes the window decoration provider API to perform ephemeral extmark rendering:

* **Incremental Treesitter Parser Callback**:
  * We register a buffer callback using `parser:register_cbs({ on_changedtree = ... })` to incrementally catch modifications.
  * We re-parse only changed nodes and cache their parsed positions (`win_states[win_id]`).
* **High-Performance Viewport Caching**:
  * In the decoration provider's `on_win` callback, we skip Treesitter parsing completely if the buffer tick (`changedtick`), viewport lines (`toprow` to `botrow`), and cache version are identical to the previous pass.
  * This guarantees 60fps scrolling performance even in files with thousands of math expressions.
* **Ephemeral Extmark Rendering**:
  * Extmarks are rendered inside the decoration provider's namespace with `ephemeral = true`.
  * The rendering loops over the cached node list in pure Lua arrays (which is highly optimized compared to hash table lookups).
* **Fine-Grained Cursor Expansion**:
  * During `on_win`, we get the cursor's current cell coordinates (`curr_row`, `curr_col`).
  * We compare them against the active node's parsed boundaries `[start_row, start_col, end_row, end_col]`.
  * If the cursor falls within a node's bounds, we bypass setting the extmark for that node, rendering raw text locally under the cursor.
* **Graphical Rendering via Kitty Protocol**:
  * For terminal emulators supporting inline images (Kitty, Ghostty, WezTerm), math expressions are compiled to SVGs/PNGs in the background.
  * An image ID is allocated for each active formula.
  * The image is uploaded to the terminal via the Kitty protocol escape sequences: `\x1b_Gq=2,f=100,t=t,i=<image_id>;<base64_path>\x1b\\`.
  * We write a matrix of special Unicode placeholders and combining diacritic characters (`kitty_codes.placeholder .. kitty_codes.diacritics[i] .. kitty_codes.diacritics[j + 1]`) matching the dimensions of the rendered formula.
  * These placeholder cells are colored with a highlight group whose foreground color hex code maps directly to the target `image_id` (e.g. `fg = string.format("#%06X", image_id)`). This instructs the terminal to render the image inline over those exact coordinates.
  * As the cursor approaches or edits a mathematical block, the graphic is cleared and the raw markup is fully expanded.

## Verification Plan

### Automated Tests

* Verify that CodeMirror ViewPlugin successfully hides math delimiters and renders KaTeX SVG containers on inactive lines.
* Verify that moving the cursor inside a math block's `[from, to]` range in CodeMirror disables the replace decoration, showing raw LaTeX text.
* Run Neovim unit tests validating that the Treesitter parse callback registers properly, caches coordinates, and successfully skips ephemeral extmarks when the cursor coordinates match the node boundaries.

### Manual Verification

* Open an active project file with several inline and block math equations.
* Verify that inline equations display beautifully with correct baseline-alignment alongside the surrounding text.
* Move the cursor step-by-step through a math equation, verifying that it expands dynamically to raw text ONLY under the cursor, while adjacent equations remain fully rendered.
