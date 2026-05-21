# Feature Card: LaTeX and Pandoc Syntax Concealing

## User Outcome

Boilerplate markup noise (like `:::`, `\hfill`, `\begin{...}`, and metadata parameters like `title=`) is visually concealed and replaced with clean replacement characters (like the long-dash `―` or custom symbols) inside the editor workspace. This ensures a distraction-free writing environment while keeping raw source formatting fully intact under the hood.

## Implementation Details

Concealing is implemented natively inside Neovim via high-performance cursor-aware rendering, and via a custom decoration extension inside CodeMirror 6.

### Neovim Integration

To achieve high-performance, fine-grained concealing without standard Neovim line-level limitations (e.g., expanding the entire line when the cursor moves over it), we adopt the architecture of [math-conceal.nvim](https://github.com/pxwg/math-conceal.nvim):

* **Treesitter & Lua Pipeline**: We register a buffer callback on Neovim's treesitter parser using `parser:register_cbs({ on_changedtree = ... })` to perform partial/incremental query updates on the changed regions.
* **Ephemeral Extmark Decorator**: Conceals are drawn dynamically using `vim.api.nvim_buf_set_extmark` with `ephemeral = true` inside a custom decoration provider namespace.
* **Fine-Grained Cursor Expansion**:
  * We attach autocmds to `CursorMoved` and `CursorMovedI` to redraw the visible window region.
  * During the render phase, we get the exact cursor coordinates (`curr_row`, `curr_col`) and compare them against each capture node range `[start_row, start_col, end_row, end_col]`.
  * If the cursor is NOT inside the capture range, the replace decoration is applied:
    ```lua
    vim.api.nvim_buf_set_extmark(buf_id, ns_id, start_row, start_col, {
      conceal = conceal_char,
      hl_group = hl_group,
      priority = priority,
      end_row = end_row,
      end_col = end_col,
      ephemeral = true,
    })
    ```
  * If the cursor is inside the capture range, we skip applying the extmark, leaving the raw LaTeX markup under the cursor fully expanded and editable.

### CodeMirror Editor Integration

For the CodeMirror editor tab, we implement a `ViewPlugin` that tracks the cursor position and renders `Decoration.replace` widgets based on the [CodeMirror Decoration Model](https://codemirror.net/examples/decoration/):

* **Conceal View Plugin**:
  ```typescript
  import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from "@codemirror/view";
  import { syntaxTree } from "@codemirror/language";

  class ConcealWidget extends WidgetType {
    constructor(readonly replacement: string) { super(); }
    eq(other: ConcealWidget) { return other.replacement === this.replacement; }
    toDOM() {
      const span = document.createElement("span");
      span.className = "cm-conceal";
      span.textContent = this.replacement;
      return span;
    }
  }

  const concealPlugin = ViewPlugin.fromClass(class {
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

      for (const { from, to } of view.visibleRanges) {
        // Iterate or match concealable constructs (e.g. delimiters, math tags)
        syntaxTree(view.state).iterate({
          from, to,
          enter: (node) => {
            if (node.name === "LaTeXDelimiter" || node.name === "PandocTag") {
              const nodeFrom = node.from;
              const nodeTo = node.to;

              // Check if cursor is currently within this node's boundaries
              const isCursorInside = cursorHead >= nodeFrom && cursorHead <= nodeTo;

              if (!isCursorInside) {
                const deco = Decoration.replace({
                  widget: new ConcealWidget("―"),
                  inclusive: false
                });
                widgets.push(deco.range(nodeFrom, nodeTo));
              }
            }
          }
        });
      }
      return Decoration.set(widgets, true);
    }
  }, {
    decorations: v => v.decorations
  });
  ```
* **Performance**: We limit range matching to the view's active `visibleRanges` (viewport) to maintain high performance in large files.
* **Themes**: Base theme configuration wraps concealed spans with custom styling (e.g., matching text opacity or color variables).

## Verification Plan

### Automated Tests

* Verify that CodeMirror rendering hides target substrings like `:::` and `\hfill` when they are present on inactive lines.
* Verify that placing the cursor on a concealed line reveals the raw source text.
