# High-Performance QuickTex-Style Snippet Expansion

The user can type short abbreviations (e.g., `st`, `cts`, `sseq`, `ga`, `mcc`) and have them instantly expand into full mathematical prose or LaTeX math symbols as they type, significantly accelerating document composition in both the Neovim and CodeMirror editor surfaces.

## Provenance and Reference Material

This feature is directly modelled on the user's existing Vim setup and configuration files:

* **Neovim Configuration**: Loader configuration is defined in [/home/dzack/dotfiles/.config-sync/nvim/init.vim#L39](file:///home/dzack/dotfiles/.config-sync/nvim/init.vim#L39) (`Plug 'dzackgarza/quicktex'`) and enabled for markdown/pandoc in [/home/dzack/dotfiles/.config-sync/nvim/init.vim#L529-L530](file:///home/dzack/dotfiles/.config-sync/nvim/init.vim#L529-L530).
* **Snippet Dictionaries**: 
  * **Prose abbreviations** are defined in [/home/dzack/dotfiles/.config-sync/nvim/after/ftplugin/pandoc/quicktex_dict.vim#L1-L109](file:///home/dzack/dotfiles/.config-sync/nvim/after/ftplugin/pandoc/quicktex_dict.vim#L1-L109).
  * **Math abbreviations** are defined in [/home/dzack/dotfiles/.config-sync/nvim/after/ftplugin/pandoc/quicktex_dict.vim#L110-L200](file:///home/dzack/dotfiles/.config-sync/nvim/after/ftplugin/pandoc/quicktex_dict.vim#L110-L200).
* **Reference Plugin**: [dzackgarza/quicktex](https://github.com/dzackgarza/quicktex)

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

## TDD Guardrails

- RED first: before adding any snippet-expansion code, write a failing browser or editor
  integration test for one exact abbreviation behavior.
- Scope the failing tests to repository-owned behavior only. For this repo, that means
  the browser editor surface the app ships, not generic Neovim/Firenvim plugin behavior
  unless the app itself owns an integration seam that changes behavior.
- Required first witnesses:
  - a failing test for a representative prose expansion such as `st` → `such that `
  - a failing test for math-only expansion guarded by real editor context
  - a failing test for a non-expansion case where the abbreviation must remain literal
- No production code may be written until the chosen witness fails for the expected
  reason.
- Tests must drive the real editor and assert exact document text after user actions. No
  mocks, no fake editor state, no `xfail`, and no `skip`.
- Assertions must prove exact text transformation and context gating, not weak claims
  like non-empty output or generic event firing.
- GREEN means the smallest change that makes the failing expansion proof pass; REFACTOR
  follows only after the targeted test and the broader suite are green.
