# Plan: Tests That Catch the File-Loading Regression

## Why This Exists

The entire test suite passes despite the CLI `[file]` argument being dead code (`cli.ts`
line 68-71). The server, client, and tests collectively ignore the core user workflow:
open a file, edit, save to disk.

## What the Current Tests Validate

- Pandoc renders markdown to HTML correctly (6 tests)
- `POST /api/render` returns valid responses (4 tests)
- Textarea typing triggers iframe updates (15 E2E tests)

**None of these verify that a file was loaded, that the textarea contains file content,
or that edits can be saved back to disk.**

## Tests to Write (RED Phase — they must fail on current code)

### 1. CLI file argument loads content into textarea

```
src/tests/file.spec.ts
```

- Create a temp markdown file with known content
- Launch server with that file path as the CLI argument
- Navigate to the page
- Assert `textarea.value === content of the file`
- Assert the initial preview renders the file content

### 2. Ctrl+S saves textarea content to disk

- Launch server with a temp file
- Clear the textarea, type new content
- Press Ctrl+S
- Read the file from disk
- Assert file content matches textarea content
- Assert the file still exists at the original path

### 3. No-arg launch shows empty placeholder

- Launch server WITHOUT a file argument
- Assert textarea is empty or shows a placeholder
- Assert no file path is associated with the session

### 4. File path is tracked across page reload

- Launch server with a temp file
- Verify textarea has content
- Reload the page
- Verify textarea still has file content (server remembers the file path across reloads)

### 5. Multiple files don't interfere

- Launch server with one file, type content, Ctrl+S
- Launch another server instance with a different file
- Verify each file has its own independent content

## Minimal Implementation to Pass (GREEN Phase)

### Server changes (`src/server/index.ts`)

Add a `file?: string` field to `ServerConfig`. The server needs to:

1. Track the current file path in memory
2. Serve the HTML page with file content embedded (so the client knows the initial
   content on first load)
3. Accept `POST /api/save` that writes `{markdown}` to the tracked file path

Approach: serve `index.html` through a simple string replace or send an inline script
tag with the initial state:

```html
<script>
  window.__INITIAL_FILE = "doc.md";
  window.__INITIAL_CONTENT = "content from file...";
</script>
```

This avoids a separate endpoint just for initial content.

### CLI changes (`src/server/cli.ts`)

The `action()` callback already receives the `file` argument (at line 54). It needs to:

1. Read the file content with `readFileSync`
2. Pass `{ file: absPath, fileContent: content }` into `ServerConfig`
3. Stop treating the file arg as a decorative log message

### Client changes (`src/client/main.js`)

The client should use `window.__INITIAL_CONTENT` if available:

```
if (window.__INITIAL_CONTENT) {
  editor.value = window.__INITIAL_CONTENT;
  scheduleRender();
}
```

For save: override the existing Ctrl+S handler to also POST to `/api/save`:

```
editor.addEventListener('keydown', async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    // trigger immediate render
    // POST /api/save with { markdown: editor.value }
  }
});
```

### Test helper changes (`src/tests/helpers.ts`)

- `launchServer()` needs to accept an optional file path arg and pass it to the spawned
  CLI process
- Add `writeTempFile(path, content)` and `readTempFile(path)` utilities

## Files Changed

| File | Change |
| --- | --- |
| `src/tests/file.spec.ts` | NEW: 5 test cases exercising file load/save workflow |
| `src/tests/helpers.ts` | Accept file arg in launchServer, add temp file helpers |
| `src/server/index.ts` | Add `file`/`fileContent` to ServerConfig, serve inlined HTML, POST /api/save |
| `src/server/cli.ts` | Read file content, pass to startServer, wire into config |
| `src/client/index.html` | Accept initial content from server |
| `src/client/main.js` | Use __INITIAL_CONTENT, implement Ctrl+S save |
| `justfile` | (unchanged) |

## Success Criteria

1. All 5 new tests pass (proving file load/save works)
2. All 25 existing tests still pass (no regressions)
3. `just run doc.md` opens the page with doc.md content in the textarea
4. Ctrl+S writes textarea content back to doc.md

## Non-Goals

- Not building a file picker or a file browser
- Not implementing multi-file workspace management
- Not detecting external file changes
- Not autosave
