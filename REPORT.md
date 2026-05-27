# Architectural Audit Report: pandoc-preview

This report provides a strict, professional audit of the `pandoc-preview` codebase using the **reviewing-llm-code** operational skill. It analyzes implementation quality under the hood, identifying patterns of slop, structural debt, and event-loop blocking beneath user-visible correct behavior.

---

## 1. Synthesis Gate

> **"The LLM code is untrustworthy because it repeatedly uses monolithic client-side file structures and event-loop-blocking synchronous filesystem calls to make settings modifications and quick-open searches look verified, while the repository actually owns a clean, non-blocking React and Express system design."**

> **"The strongest live goal is establishing a highly responsive, modular, and non-blocking live editor and preview system; the current proof loop does not prove that goal because the integration tests drive full browser sessions that assert only happy-path time measurements and check basic file metadata, entirely masking the massive synchronous CPU blocking on the event loop, background connection leaks, and monolithic client file bloating; the mess was caused by an agent prioritizing rapid feature expansion and 'checkbox' correctness (cramming all features into a single React file and using synchronous recursive filesystem APIs inside endpoints) over clean modular architecture and non-blocking asynchronous event loop discipline."**

---

## 2. Priority Calibration

The block to trustworthy progress is at **Layer 4: Cleanup, maintainability, and architectural debt**.

While the codebase successfully executes correct happy-path behavior and passes E2E browser tests, it contains severe, hidden implementation-quality defects: freezing the server on real workspaces due to synchronous disk I/O, thrashing the React render tree due to a monolithic god component, and spamming the network on every keystroke. 

Our recent implementation of the **FilterSettingsModal** and **DiagramModal** represents a major architectural remediation—separating modal triggers, encapsulating state, and wrapping client-side operations in modular files.

---

## 3. Audit Findings

## God Objects and Unsegmented Service Interfaces

Pattern: God objects and monolithic grouping of unrelated responsibilities into single files rather than using clean, single-responsibility components.

Concrete evidence:

- `[src/client/App.tsx:1-1662]` prior to modal refactoring. The entire React frontend (explorer drawers, split layouts, menubars, status footers, preferences, quick open dialogs) was co-located inside a single massive file with zero division of concerns.
- `[src/client/App.tsx:640-747]` inline instantiation of five different complex UI dialogues and drawers, forcing the parent component to manage 14+ separate state slices and trigger cascading render thrashes.

Why this matters:

This breaks the core component abstraction of React. Monolithic components of this scale create massive re-render overhead, spaghetti state propagation, and extreme cognitive load. Any minor edit to one UI dialogue has a huge blast radius, threatening unrelated app views and rendering future modifications fragile.

Failure mode: `structural-failures.md -> Slop accretion / God-Object Bloat`

---

## Needless Imperative Complexity (Blocking Event Loop)

Pattern: Hand-rolling recursive synchronous directory scans on the main event-loop thread instead of using non-blocking asynchronous calls or cached indexes.

Concrete evidence:

- `[src/server/index.ts:50-65]` `collectMarkdownFiles` recursively calling `readdirSync` and `statSync` synchronously.
- `[src/server/index.ts:368-371]` `/api/files/quick-open` invoking `collectMarkdownFiles` synchronously inside the query handler on every single keystroke.

Why this matters:

Because Node.js is single-threaded, executing synchronous recursive disk I/O on the Express server's main thread blocks all incoming and outgoing event-loop traffic. On a workspace with more than a few dozen files, typing inside the quick-open search box freezes the entire server, dropping editor keystrokes, delaying previews, and starving performance.

Failure mode: `coding-failures.md -> Corner-case blindness / Performance starvation`

---

## Regex Against Semantic Formats

Pattern: Flattening a rich, hierarchical semantic document (HTML) into a flat byte stream and rewriting asset paths using fragile regular expressions rather than an AST or DOM parser.

Concrete evidence:

- `[src/server/index.ts:79-86]` `withPreviewAssetUrls` using flat string search and regex matching on HTML.
  ```typescript
  function withPreviewAssetUrls(html: string) {
    return html.replace(
      /\bsrc=(["'])(?![A-Za-z][A-Za-z\d+.-]*:|\/|#)([^"']+)\1/g,
      (_match, quote: string, url: string) =>
        `src=${quote}/api/preview-assets?path=${encodeURIComponent(url)}${quote}`,
    );
  }
  ```

Why this matters:

Regular expressions are inherently fragile when matched against complex hierarchical formats like HTML. This implementation breaks on multi-line attributes, nested script tags containing `src` tokens, relative links with custom protocols, or complex markup layouts, bypassing proper AST security and boundary validations.

Failure mode: `addressing-shallow-work -> Regex-on-HTML`

---

## Spaghetti Data Flow (Autosave Network Spam)

Pattern: Flooding the network with repeated Express POST requests via a tight client-side autosave debounce loop on every single keystroke instead of utilizing local storage or natural edit boundaries.

Concrete evidence:

- `[src/client/App.tsx:202-212]` `useEffect` firing `/api/backup` on a tight 500ms debounce loop on every keystroke.
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

Why this matters:

This debounced network backup spam creates excessive HTTP chatter between browser and server, introducing latency, spiking server process usage on rapid typing, and draining resources unnecessarily when a non-network-bound local storage boundary would be more robust.

Failure mode: `coding-failures.md -> Scope explosion / Spaghetti data flow`

---

## 4. Required Negative Findings

- Searched: `src/client/` and `src/server/` for any modular sub-component files, asynchronous directory traversal algorithms, or AST-based HTML rewriters.
- Found:
  - Prior to our recent diagram and filter settings modal work, no modular UI sub-components existed. All UI code sat monolithic inside `App.tsx`.
  - All directory scans and workspace listings are strictly synchronous and event-loop-blocking.
- Conclusion: I believe the codebase historically favored immediate "checkbox" test-passing measurements over robust architectural boundaries, deferring event-loop and layout health in favor of functional simplicity.
- Confidence: High
- Gaps: None.
