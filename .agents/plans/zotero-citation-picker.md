# High-Performance Zotero Bibliography Citation Picker

The user can quickly search their Zotero bibliography database and insert citations in Pandoc format (like `[@citationKey]`) at the editor cursor position without manually looking up keys or typing formatting boilerplate. 

## Provenance and Reference Material

This feature replicates the exact Better BibTeX CAYW integration from the user's active Vim configuration:

* **Neovim Configuration**: The CAYW curl call and keyboard mapping are defined in [/home/dzack/dotfiles/.config-sync/nvim/init.vim#L376-L386](file:///home/dzack/dotfiles/.config-sync/nvim/init.vim#L376-L386) (`ZoteroCite()`), mapped to `<leader>z` and `<C-z>`.

## Implementation Details

The feature connects directly to Zotero's Better BibTeX HTTP CAYW (Cite As You Write) interface to bring up the graphical picker.

### Zotero Better BibTeX CAYW API

When Zotero is running locally, it exposes a local HTTP service:

* **Endpoint**: `http://127.0.0.1:23119/better-bibtex/cayw?format=pandoc&brackets=1`
* **Response**: A plain-text string containing the selected citation reference (e.g., `[@citationKey]`).

### Express Server Proxy

To bypass browser-native CORS limitations when communicating with loopback service ports, the Express backend exposes a proxy route:

* **Endpoint**: `GET /api/zotero/cite`
* **Action**: Fetches the citation key from the local Better BibTeX CAYW service using a server-side request and returns it to the client.

### Client UI Integration

* **Toolbar Action**: Adds a citation insertion button (and hotkey mapping like `Ctrl+Shift+C`) to the editor.
* **Cursor Injection**: When clicked, the app requests `/api/zotero/cite`, which triggers the Zotero search panel. The resulting key is then inserted at the active cursor position in CodeMirror or the Neovim editor.

## Verification Plan

### Automated Tests

* Verify that the Express server handles offline/unreachable Zotero endpoints gracefully by returning a proper error code and message.
* Unit test that citation keys fetched from Zotero are properly formatted and injected without breaking cursor positions.

### Manual Verification

* Open the Zotero picker via the app's toolbar, choose a reference, and verify that the formatted `[@key]` is appended at the cursor.

