# Feature Card: CriticMarkup GUI Interaction (Commentator-style)

## User Outcome

The user can add, review, accept, and reject CriticMarkup annotations in the document
without writing raw syntax.
This means: select text → popup with "Insertion", "Deletion", "Comment", "Highlight" →
the syntax is generated and rendered correctly.
An annotation panel lists all suggestions and comments across the document with accept/
reject buttons. Diff rendering in the preview is toggled interactively.

This is distinct from basic CriticMarkup *rendering* in the preview pipeline (see
`pancritic-integration.md`). This is the editing/interaction layer.

## Can This Already Be Done?

Yes — [**Fevol/obsidian-criticmarkup**](https://github.com/Fevol/obsidian-criticmarkup)
(240 stars, active, called "Commentator") already implements all of this for Obsidian's
CodeMirror 6 editor.
It builds on
[kometenstaub/obsidian-criticmarkup](https://github.com/kometenstaub/obsidian-criticmarkup)
and [kometenstaub/lang-criticmarkup](https://github.com/kometenstaub/lang-criticmarkup)
(standalone parser).

The app uses the same editor framework (CodeMirror 6) as Obsidian, so the interaction
patterns are directly portable.
These plugins should be the primary reference implementation — do not build from
scratch.

## Existing Reference Code

| Component | Source | Language | Notes |
| --- | --- | --- | --- |
| CriticMarkup parser | `kometenstaub/lang-criticmarkup` | TypeScript | Standalone CodeMirror 6 mode/parser for CriticMarkup syntax |
| Suggestion mode (WYSIWYG) | `Fevol/obsidian-criticmarkup` | TypeScript/Svelte | Tracks insertions/deletions in editor, correct cursor placement |
| Comment mode | `Fevol/obsidian-criticmarkup` | TypeScript/Svelte | Popup-on-selection to leave comments, threads, replies |
| Accept/reject commands | `Fevol/obsidian-criticmarkup` | TypeScript | Per-change and bulk accept/reject via command palette, selection, gutter |
| Annotation panel | `Fevol/obsidian-criticmarkup` | Svelte | Vault-wide index of all suggestions/comments with metadata, filters |
| Preview rendering | `Fevol/obsidian-criticmarkup` | TypeScript | CriticMarkup rendering in Live Preview and Reading View |
| Syntax extensions | `Fevol/obsidian-criticmarkup` | TypeScript | Authorship/timestamp annotation, comment threads, custom highlight colors |

## Which Layer Owns the Outcome

| Sub-outcome | Owner | Rationale |
| --- | --- | --- |
| CriticMarkup text parsing in editor | Client (CodeMirror extension) | Same as `lang-criticmarkup` CM6 mode |
| Popup-on-selection to add markup | Client (CodeMirror extension + React) | Cursor position is browser-only |
| Accept/reject commands | Client (CodeMirror extension) | Operates on editor text, sends updated text to render |
| Diff preview rendering | Server (render pipeline via pancritic) | See `pancritic-integration.md`; mode toggle sent as render param |
| Annotation panel | Client (React/Svelte component) | Indexed from editor content, rendered in sidebar |
| Auto-close brackets, correction | Client (CodeMirror extension) | Editor behavior, no server involvement |

## Proposed Integration

### Study-First Approach

Before writing any code, study these source trees:

1. **`kometenstaub/lang-criticmarkup`** — the parser is the foundation.
   It's a standalone CodeMirror 6 language mode.
   This can likely be used as-is.
2. **`Fevol/obsidian-criticmarkup/src/`** — the core interaction logic.
   Specifically:
   - `suggestion-mode/` — how edit operations are converted to CriticMarkup
   - `comment-mode/` — comment popup and thread logic
   - `accept-reject/` — bulk/per-change accept/reject
   - `renderer/` — how CriticMarkup syntax is visually rendered in the editor
   - `annotation-panel/` — the sidebar view (Svelte, may adapt as React)

### Architecture

The app already has CodeMirror 6 via `@uiw/react-codemirror`. The CriticMarkup parser
can be registered as a CodeMirror language extension (or overlay on top of markdown
parsing).

```
┌─ Editor Pane ───────────────────────────────────┐
│  [text with {--critic--} markup]                 │
│    ┌──────────────────────────────────────┐      │
│    │ Selection popup:                      │      │
│    │ [Insert] [Delete] [Comment] [Highlight]     │
│    └──────────────────────────────────────┘      │
│                                                  │
│  ┌─ Annotation Panel (sidebar) ────────────┐     │
│  │ 📝 Suggestions (3)                       │     │
│  │  [✓] "bad" → deleted by @user         │     │
│  │  [x] "good" → added by @user          │     │
│  │  [💬] Comment: "Fix this"              │     │
│  └─────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
```

The rendering pipeline from `pancritic-integration.md` handles the preview rendering;
this feature provides the *editing* side.

## Non-Goals

- Not writing a CriticMarkup parser from scratch (use `lang-criticmarkup`)
- Not porting Obsidian-API-specific code (Obsidian plugin API → the app's own CM6
  wiring)
- Not shipping pancritic or managing Python dependencies (covered by the rendering card)
- Not implementing multi-user collaboration (vault-wide views are single-user)

## Open Questions

1. **Parser conflict with markdown**: CriticMarkup `{-- --}` uses curly braces that may
   conflict with existing Pandoc markdown parsing.
   Does `lang-criticmarkup` handle this via CodeMirror syntax layering?
   Check how Obsidian runs it alongside its markdown parser.
2. **Fevol's code is Svelte-based**: The annotation panel uses Svelte components.
   These would need to be either imported via Svelte-in-React bridge or rewritten as
   React components. The core interaction logic (suggestion mode, comment mode) is
   framework- independent TypeScript and should be portable as-is.
3. **CM6 version compatibility**: The Obsidian plugin targets the specific CM6 version
   that Obsidian ships.
   The app may be on a different version.
   Check `@uiw/react-codemirror` version compatibility with the `@codemirror/state` and
   `@codemirror/view` APIs used by the parser and suggestion mode.
