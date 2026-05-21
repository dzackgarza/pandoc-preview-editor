# Feature Evaluation Framework

Every proposed feature for pandoc-preview must pass through this framework before being
added to a card.

## Current Architecture Assumption

The shipped app is a browser-based plain text editor plus live Pandoc preview. Firenvim
can edit the textarea, but Firenvim does not give the app a project file, file picker,
workspace tree, or save target. It synchronizes text between nvim and the textarea.

Therefore:

- The textarea value is the canonical in-app document text.
- The app owns file-system operations: open, new, save, workspace listing, selected-file
  tracking, and file-path delivery to server-side tools.
- Nvim/Firenvim owns editor mechanics inside the textarea: modal editing, motions,
  mappings, snippets, completion, and other text-editing behavior.
- Renderer invocation, render status, exports, and command execution are server/app
  concerns. Renderer-specific templates, filters, formats, and flags belong in config or
  wrapper commands, not app-owned request fields.

## Questions

### What is the user outcome?

Define the feature by the outcome the user needs, not by the widget that delivers it.
The outcome frames everything else.

**Wrong**: "Add an Explorer drawer."

**Right**: "The user can choose which project file the textarea edits and saves."

### Is the outcome still needed?

The first decision is whether the new shipped model makes the feature unnecessary. If
Firenvim, nvim, the browser textarea, or Pandoc already owns the complete user outcome,
remove the card from the active feature set. Do not rewrite an obviated feature as a new
candidate merely because the app has a nearby responsibility.

Obviated cards are not backlog items. They belong in git history, not in active plans.

### Which layer owns the remaining outcome?

Use these ownership rules:

| Outcome | Owner | Reason |
| --- | --- | --- |
| Text editing behavior | Firenvim/nvim | Obviated as app work. Do not keep a feature card. |
| Current document text | App textarea | Firenvim syncs text, not file identity. |
| Open/new/save | App/server | The browser app must map textarea text to disk. |
| Workspace file list | App/server | Firenvim does not expose a workspace tree to the app. |
| Render timing/status | App/server | Pandoc runs in the preview server. |
| Renderer command configuration | Config/server | The app invokes the configured command without knowing renderer-specific flags. |
| Export/plugin commands | App/server | Commands need file paths and filesystem access. |

### Can an existing tool already provide the owned layer?

Research mature dependencies before building:

- For editor mechanics, check nvim built-ins and plugins.
- For UI controls, prefer established React/Radix/CodeMirror patterns already in the app.
- For rendering and document conversion, use Pandoc features rather than reimplementing
  markdown, math, templates, or filters.
- For filesystem access, keep it on the server side and constrain it to the workspace
  root.

### Does the app need a durable state model?

If a feature changes file identity, workspace root, save target, command config, or plugin
execution, define the canonical server/client state before adding UI. Do not infer file
identity from Firenvim buffers or temporary files.

Do not create a new app-owned feature from an old card unless the user outcome still
exists after Firenvim/plain-text editing. A deleted nvim-plugin recommendation does not
automatically become an app feature.

### Has this been researched?

Before writing any "Can This Already Be Done?" section:

- Check Firenvim behavior when the feature depends on textarea vs filesystem semantics.
- Check current app code and tests for the existing owned surface.
- Check library/tool docs for any dependency-specific behavior.
- State gaps explicitly when evidence is incomplete.

## Decision Tree

```
User outcome defined
        |
        v
Is the complete outcome already handled by Firenvim, nvim, the textarea, or Pandoc?
   YES ---> Delete the active card. It is obviated.
   NO ----> Does it need file identity, filesystem access, render state, or commands?
               |
               v
            YES ---> App/server owns it. Build on existing endpoints/state.
            NO ----> Research whether an existing app dependency handles it cleanly.
```

## Examples

| Feature | User Outcome | Owner | Verdict |
| --- | --- | --- | --- |
| Save current document | Textarea content reaches disk | App/server | Already incorporated |
| File tree | User chooses project file | App/server | Already incorporated as Explorer |
| Last saved state | User knows textarea differs from disk | App/client | Keep status indicator |
| Compilation time | User knows how long render took | App/server | Already incorporated |
| Renderer command config | User sets render pipeline | Config/server | Already incorporated; test as renderer-agnostic invocation |
| Centralized Pandoc templates/filters | User reuses one Pandoc setup | Config/wrapper | Keep in `~/.pandoc`, not app request fields |
| Manual refresh | User re-renders after external inputs change | App/server | Already incorporated |
| Editor autosave plugin research | Editor writes its own buffer automatically | Firenvim/nvim | Obviated as app work; no active card |
| Terminal shortcut shielding | Browser forwards terminal chords | Removed layer | Obviated; no active card |
| Editor session restore | Editor restores buffers/layout | Firenvim/nvim | Obviated as app work; no active card |
| Nvim motions/snippets | User edits text efficiently | Firenvim/nvim | Obviated as app work; no active card |
