# Feature Card: QuickTex-Style Snippet Expansion

## User Outcome

The user can type short abbreviations (e.g., `st`, `cts`, `sseq`, `ga`, `mcc`) and have them instantly expand into full mathematical prose or LaTeX math symbols as they type, significantly accelerating document composition in both the Neovim and CodeMirror editor surfaces.

## Editor Integrations

The system ensures that abbreviations are supported regardless of which editor tab is active.

### Neovim Integration

Because the headless Neovim editor is fully native, the existing QuickTex Vim configuration is rolled in directly:

* **Setup**: The app's custom Neovim initialization file (`init.vim` / `init.lua`) automatically loads the `dzackgarza/quicktex` plugin.
* **Dictionary Sync**: The dictionary definitions located in `~/.config/nvim/after/ftplugin/pandoc/quicktex_dict.vim` are mapped to the headless buffer natively, maintaining identical muscle memory.

### CodeMirror Editor Integration

For the browser-native CodeMirror editor, snippet and abbreviation expansion is achieved through a custom-rolled extension or similar lightweight library.

* **Extension Mechanism**: A CodeMirror state extension listens to cursor and transaction changes. When a trigger key (such as spacebar or tab) is pressed, it checks the word immediately preceding the cursor against the active dictionary.
* **Context Awareness**: The extension differentiates between **Prose Mode** and **Math Mode**:
  * Prose abbreviations are active by default across normal text.
  * Math abbreviations are active only when the editor determines the cursor is enclosed inside inline `\( ... \)` or display `\[ ... \]` boundaries.
* **Placeholders**: The expander supports `<+++>` placeholders for tab-to-advance navigation, matching the Vim QuickTex mechanics.

## Verification Plan

### Automated Tests

* Verify that typing `st` followed by a space inside the CodeMirror editor expands to `such that `.
* Verify that typing math-mode abbreviations does not expand when outside a math boundary, and expands correctly when inside `\(` or `\[`.
