# Feature Card: Ctrl+P Quick-Open File Palette

## User Outcome

Press Ctrl+P (Cmd+P on macOS), type a fuzzy substring match, and select a file to open
immediately.
The list shows recently opened markdown files first, then all markdown files
in the workspace. The selection opens the file in the editor, replacing the current
content and setting the save target — same as clicking a file in the Explorer drawer.

## Can This Already Be Done?

Partially.
The **Explorer drawer** (`file-tree-drawer.md`) provides a navigable file tree
with lazy directory loading and text filtering (`ExplorerDrawer` in `App.tsx`,
`/api/files` endpoint).
But it requires mouse interaction or multiple keyboard tab/arrow navigations, and its
text filter only filters the *currently visible* directory listing, not the whole
workspace. There is no recent-files tracking.

The closest parallel is VS Code's Ctrl+P (Quick Open) or fzf/fzf.vim in the terminal.

## Which Layer Owns the Outcome

| Sub-outcome | Owner | Rationale |
| --- | --- | --- |
| Keyboard shortcut Ctrl+P | Client (App.tsx keybinding) | Browser keyboard event |
| Fuzzy-search modal UI | Client (React component, e.g. Radix Dialog) | Browser UI element |
| File list (recent + workspace) | Server (new endpoint) | Filesystem access; recent-file tracking is server state |
| Fuzzy filtering | Client (local in-browser filter) | Instant responsiveness; data set is small (workspace files) |
| File open on selection | Client (load content via `/api/files/content`) | Same flow as Explorer drawer |

## Proposed Architecture

### Server: New Endpoint

```
GET /api/files/quick-open?q=
```

Returns a combined list of:

1. **Recently opened files** (up to ~10, most-recent-first): tracked server-side in
   memory (add to `ServerConfig` or a `Set<string>` that gets updated on every file open
   via the client). Persisted for the server session only — no disk persistence needed
   for MVP.
2. **All markdown files in the workspace**: recursively walk the workspace from
   `workspaceRoot`, respecting existing ignore rules (`shouldIgnore` from
   `workspace.ts`), filtering to `*.md` files.
   This can be cached and invalidated on file create/delete.

```typescript
// Response
interface QuickOpenEntry {
  path: string;         // workspace-relative path
  name: string;         // basename
  recent: boolean;      // true if in recent list
  dir: string;          // parent directory (for display grouping)
}
```

The `q` query parameter filters the list server-side (or the client can filter a
pre-fetched full list).
MVP: pre-fetch the full list and filter client-side, since the workspace is typically
small (< 10k files).

### Client: QuickOpen Component

- Triggered by Ctrl+P / Cmd+P (prevent default browser print dialog)
- Radix Dialog (or similar) with an `<input>` that auto-focuses
- Fuzzy-match results displayed in a scrollable list
- Keyboard navigation: arrow keys to move, Enter to open, Esc to dismiss
- Opens file via the same path as Explorer drawer: fetch content, update editor, set
  current file identity

```
┌─ Quick Open ──────────────────────┐
│ > [query___________]               │
│                                    │
│ 📁 Recent                          │
│   doc.md                           │
│   thesis/chapter-2.md              │
│                                    │
│ 📁 Workspace                       │
│   src/client/utils.ts              │
│   tests/file.spec.ts               │
│   docs/architecture.md             │
│   ...                              │
└────────────────────────────────────┘
```

### Recent Files Tracking

The client already tells the server which file is current when opening files (via
`/api/files/content` and file selection).
Track this server-side:

```typescript
// In ServerConfig or a dedicated tracker
const recentFiles: string[] = [];

// Update on file open (already happens via /api/files/content)
function trackRecent(filePath: string) {
  recentFiles = [filePath, ...recentFiles.filter(f => f !== filePath)].slice(0, 10);
}
```

### Fuzzy Matching

For MVP, a simple substring match (case-insensitive) on the filename and full path is
sufficient. For v2, use a proper fuzzy-scoring algorithm (e.g.,
[fuse.js](https://www.npmjs.com/package/fuse.js) or a lightweight scorer).

## Files Changed

| File | Change |
| --- | --- |
| `src/server/index.ts` | Add `GET /api/files/quick-open` endpoint, recent-files tracker |
| `src/server/cli.ts` | Initialize recent-files state in `ServerConfig` |
| `src/client/App.tsx` | Register Ctrl+P keybinding, add `QuickOpen` state/modal |
| `src/client/QuickOpen.tsx` | NEW: fuzzy-search dialog component |
| `src/client/lib/utils.ts` | Optional: fuzzy-score helper |

## Non-Goals

- File creation from the palette (post-MVP feature)
- Symbol search (variables, headings, etc.)
- Git status badges on files
- Persistent recent-files across app restarts
- Multi-select or batch operations
- Replacing the Explorer drawer (both coexist)

## Acceptance Criteria

- [ ] Ctrl+P opens the quick-open dialog with input auto-focused
- [ ] Typing filters the file list by fuzzy/substring match on name and path
- [ ] Recently opened files appear at the top with a "Recent" section header
- [ ] Arrow keys navigate the result list; Enter opens the selected file
- [ ] Esc dismisses the dialog without changing the current file
- [ ] Opening a file via quick open updates the editor content and save target
- [ ] Opening a file via quick open adds it to the recent list
- [ ] The workspace file list respects existing ignore rules from `workspace.ts`
- [ ] Only `.md` files appear in the workspace list
- [ ] Existing Explorer drawer and file workflows are unaffected
