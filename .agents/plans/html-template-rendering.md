# Feature: HTML Template Rendering QA

## Problem

Users may provide a custom HTML template in `~/.pandoc/templates/` that pandoc uses with
the `--template` flag.
This template controls the full HTML structure of the preview output, including:
- DOCTYPE and `<html>` wrapper
- CSS link tags
- JavaScript includes (MathJax, highlight.js)
- Custom header/footer content
- Metadata injection

If the template has errors (malformed HTML, broken CSS paths, missing closing tags), the
preview may render incorrectly or not at all.
The app should detect and report template rendering issues.

## Can This Already Be Done?

pandoc itself reports template errors during rendering.
If the template has a syntax error, pandoc exits with a non-zero code and an error
message. Currently, the app may silently swallow these errors (pandoc output goes to a
buffer but isn't surfaced to the user).

This feature is about surfacing template rendering failures in the GUI so users can
debug them without checking the server logs.

## Proposed Solution

### Template Existence Check

On file open / preview start, check if `~/.pandoc/templates/default.html` exists (the
default HTML template path for pandoc).
If it doesn't exist, pandoc falls back to its built-in template -- this is not an error
but worth noting for users who expect a custom template.

### Template Rendering Test

When the user requests a refresh or the preview updates:

1. Capture stderr from the pandoc process
2. If stderr contains template-related errors (check for patterns like "template",
   "Unknown template", "Error compiling template"):
   - Display the error in a non-intrusive banner at the top of the preview
   - Continue to show the rendered output (if pandoc produced any partial HTML)
   - Do NOT block the preview -- template errors are informational
3. If pandoc exits with code 0, clear any previous template error

### Validation Checks

Beyond syntax errors, validate:

1. **DOCTYPE presence**: The rendered HTML should have a `<!DOCTYPE html>` or similar
   doctype declaration
2. **Viewport meta tag**: For mobile-friendly previews
3. **CSS link integrity**: Link hrefs should point to accessible files (checked on
   server side, not in the preview iframe)
4. **Closing tag balance**: Use a simple HTML tag balance check (not a full parser --
   pandoc's error reporting covers syntax)

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

The expected output should include:
- Title/subtitle/author/date from metadata
- Proper heading hierarchy
- Rendered lists, code blocks, tables
- Math (if MathJax config is in template)
- Syntax highlighting (if highlight.js config is in template)

### Test Procedure

1. Run pandoc with `--template ~/.pandoc/templates/default.html --metadata
   title="Test"` on the test document
2. Verify the output HTML structure:
   - Contains title in `<title>` tag
   - Contains `<body>` with rendered content
   - Contains the CSS / JS links from the template
   - All structural HTML tags are properly closed
3. If the template uses custom variables (`$title$`, `$body$`, etc.),
   verify they are correctly substituted

### Error Display in GUI
```
+----------------------------------------------------------+ | ⚠ Template warning:
Unknown template variable $custom$ | | (pandoc: template error) [Dismiss] |
+----------------------------------------------------------+ | [preview content...] |
+----------------------------------------------------------+
```

## Human Decisions Needed

1. **Error severity**: Should template errors block the preview or just show
   a warning? Recommendation: warning only -- the preview might still be useful.
2. **Auto-dismiss**: Should errors auto-dismiss on the next successful render?
   Yes, to avoid stale warnings.
3. **Template path**: Hard-coded `~/.pandoc/templates/default.html` vs.
   configurable (see `settings-dropdown-pandoc-command.md`). If the pandoc
   command is configurable, the template path is already covered there.

## Future Possibilities

- Template preview (side-by-side or diff view showing template source vs.
  rendered output)
- Built-in template browser showing available templates in `~/.pandoc/templates/`
```
