# Feature: Centralized Renderer Output QA

## Problem

Users may configure a renderer wrapper that uses centralized Pandoc templates in
`~/.pandoc/templates/`. Those templates can control the full HTML structure of Pandoc
output, including:
- DOCTYPE and `<html>` wrapper
- CSS link tags
- JavaScript includes (MathJax, highlight.js)
- Custom header/footer content
- Metadata injection

If the configured renderer emits malformed HTML or exits with template-related stderr,
the preview may render incorrectly or not at all. The app should surface renderer
stderr and nonzero exits, but it must not own Pandoc template flags or template paths.

## Can This Already Be Done?

Yes. Pandoc and wrapper scripts can reference `~/.pandoc/templates/` directly from the
configured renderer command. Pandoc reports template errors through stderr and nonzero
exit codes.

This feature is not about adding template request fields, GUI template controls, or
project-local template folders. It is about proving the app surfaces configured renderer
output and diagnostics.

## Proposed Solution

Keep template selection in the configured renderer command or wrapper. For Pandoc, the
central location is `~/.pandoc/templates/`.

Regression tests belong at the renderer boundary:

- A configured wrapper emits representative HTML and the preview displays it.
- A configured wrapper exits nonzero with stderr and the render response exposes that
  stderr.
- No `/api/render` field is added for templates.

### Test Document

Create a test document that exercises template features:

````markdown
---
title: "Template Test"
subtitle: "Testing custom templates"
author: "Test Runner"
date: 2026-05-19
---

# Heading 1

Normal paragraph with **bold** and *italic*.

## Heading 2

- List item 1
- List item 2

```python
print("code block")
````

| Col1 | Col2 |
| --- | --- |
| A | B |
```

Use this as input to a configured wrapper or local manual QA command. The app test should
assert only renderer-boundary behavior, not Pandoc template semantics.

### Test Procedure

1. Configure a renderer or wrapper that references `~/.pandoc/templates/`.
2. Render the test document through the app.
3. Verify the app displays stdout HTML and surfaces stderr/nonzero exits.

### Error Display in GUI
```
+----------------------------------------------------------+ | ⚠ Template warning:
Unknown template variable $custom$ | | (pandoc: template error) [Dismiss] |
+----------------------------------------------------------+ | [preview content...] |
+----------------------------------------------------------+
```

## Human Decisions Needed

- Whether to add a richer renderer diagnostics UI beyond the current error document.

## Future Possibilities

- Template preview (side-by-side or diff view showing template source vs.
  rendered output)
- Read-only listing of centralized `~/.pandoc/templates/`
```
