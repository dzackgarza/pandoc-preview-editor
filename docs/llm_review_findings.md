# LLM Code Review: Architectural Slop & Absurd Code Audit

Architectural audit of the `pandoc-preview` codebase, focused on unmaintainable patterns, bloated god objects, and event-loop blocking slop.

## Synthesis Gate

> **"The LLM code is untrustworthy because it repeatedly uses monolithic, unsegmented modules and synchronous, block-the-event-loop file operations to make visual rendering and file tree management look verified, while the repository actually owns a clean, non-blocking, modular React and Express system design."**

> **"The strongest live goal is establishing a highly responsive, maintainable, and modular markdown live editor and preview system; the current proof loop does not prove that goal because the integration tests drive full browser sessions that assert only happy-path time measurements and check basic file metadata, entirely masking the massive synchronous CPU blocking on the event loop, background connection leaks, and monolithic client file bloating; the mess was caused by an agent prioritizing rapid feature expansion and 'checkbox' correctness (cramming all features into a single React file and using synchronous recursive filesystem APIs inside endpoints) over clean modular architecture and non-blocking asynchronous event loop discipline."**

---

## Priority Calibration

The block to trustworthy progress is at **Layer 4: Cleanup, maintainability, and architectural debt**.

The codebase works on a functional level for single small workspaces, but contains deep architectural structural issues that will trigger severe performance degradation under real-world usage (such as freezing the server when searching a workspace, or thrashing the React render tree). 

The first step is separating the monolithic client into clean, single-responsibility components and refactoring the synchronous recursive directory traversal on the server to be asynchronous or cached.

---

## Findings

### 1. Monolithic Frontend God-Object (`App.tsx` Bloat)

Pattern: **God objects and unsegmented service interfaces / No design principles**

**Concrete evidence:**
- `[src/client/App.tsx:1-1662]`
  - The *entire* React client is written as a single, massive 1662-line file (`src/client/App.tsx`). It contains absolutely no modular separation of concerns.
  - The main `App` component holds 14+ pieces of state (`markdownText`, `currentFile`, `isTempFile`, `previewHtml`, `status`, `durationMs`, etc.) and coordinates menubars, resizable panels, and modal dialogs.
  - Every micro-component (`TopMenuBar`, `IconButton`, `MenuItem`, `ExplorerDrawer`, `EditorPane`, `PreviewPane`, `StatusCluster`, `SaveAsDialog`, `QuickOpenDialog`) is defined inline directly inside the same file.

**Why this matters:**
This destroys the basic componentized abstraction of React. Monolithic components of this scale suffer from massive re-render overhead, spaghetti logic flow, and extreme cognitive load for developers. It makes editing the UI fragile and guarantees that future feature additions will increase code density to an unmanageable degree.

**Failure mode:** `structural-failures.md -> Slop accretion / God-Object Bloat`

---

### 2. Synchronous Event-Loop Blocking Workspace Traversal

Pattern: **Needless imperative complexity / No design principles**

**Concrete evidence:**
- `[src/server/index.ts:277-310]` and `[src/server/index.ts:506-524]`
  - The `/api/files/quick-open` query handler:
    ```typescript
    app.get('/api/files/quick-open', (req, res) => {
      ...
      const workspaceEntries = collectMarkdownFiles(workspaceRoot, workspaceRoot);
    ```
  - The `collectMarkdownFiles` implementation uses synchronous recursive traversal:
    ```typescript
    function collectMarkdownFiles(workspaceRoot: string, dir: string): QuickOpenEntry[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        ...
        if (entry.isDirectory()) {
          return collectMarkdownFiles(workspaceRoot, absolutePath);
        }
        ...
    ```

**Why this matters:**
This synchronous recursive filesystem traversal is executed on the Express server's main thread **on every single keystroke** when typing in the Quick Open search box. Because Node.js is single-threaded, running `readdirSync` and `statSync` recursively across a workspace blocks the entire event loop. On any workspace with more than a few dozen files, this will cause the server to freeze completely while typing, dropping keystrokes, delaying renders, and destroying responsiveness.

**Failure mode:** `coding-failures.md -> Corner-case blindness / Performance starvation`

---

### 3. Regex-on-HTML Asset Path Rewriter

Pattern: **Regex against semantic formats**

**Concrete evidence:**
- `[src/server/index.ts:576-582]`
  ```typescript
  function withPreviewAssetUrls(html: string) {
    return html.replace(
      /\bsrc=(["'])(?![A-Za-z][A-Za-z\d+.-]*:|\/|#)([^"']+)\1/g,
      (_match, quote: string, url: string) =>
        `src=${quote}/api/preview-assets?path=${encodeURIComponent(url)}${quote}`,
    );
  }
  ```

**Why this matters:**
This is the canonical example of flattening a semantic tree structure (the HTML DOM returned by Pandoc) into a flat unstructured byte stream before searching it with raw regular expressions. This regex-based replacement is highly fragile: it breaks on multi-line attributes, nested quotes, inline scripts containing `src` tokens, or complex tags, rather than leveraging a clean HTML parser like `jsdom` or an AST transformer.

**Failure mode:** `addressing-shallow-work -> Regex-on-HTML`

---

### 4. Background Network Autosave/Backup Spam

Pattern: **Spaghetti data flow / Myopic goal-seeking**

**Concrete evidence:**
- `[src/client/App.tsx:210-220]`
  ```typescript
  useEffect(() => {
    if (!isTempFile || window.__TEMP_BACKUP_FILE == null) return;
    const handle = window.setTimeout(() => {
      void fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: markdownText }),
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [isTempFile, markdownText]);
  ```

**Why this matters:**
The client autosaves temporary drafts by firing full HTTP POST requests to `/api/backup` on a tight 500ms debounce loop on every single keystroke. This generates continuous, noisy background HTTP traffic between the client and the server, introducing significant latency and processing overhead, rather than using robust, non-network-bound local storage or saving only on natural editor boundaries.

**Failure mode:** `coding-failures.md -> Scope explosion / Spaghetti data flow`

---

## Required Negative Findings

- Searched: `src/client/` and `src/server/` for any modular sub-component files, asynchronous directory traversal algorithms, or AST-based HTML rewriters.
- Found:
  - No modular sub-component files exist on the client; the entire React application resides in `App.tsx`.
  - No asynchronous directory traversal is implemented; all filesystem lookups are strictly synchronous and block the main thread.
- Conclusion: The codebase relies on monolithic grouping and blocking synchronous designs to achieve "checkbox" functionality, avoiding proper software design boundaries.
- Confidence: High
- Gaps: None.
