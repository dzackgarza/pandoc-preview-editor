# Feature: Responsiveness and Rendering Efficiency

## Status

Partly incorporated.

## Problem

The app re-renders the full document through Pandoc after textarea changes. This is the
right correctness boundary, but large documents, filters, citations, and MathJax can make
rendering slow.

## Current Behavior

- Textarea changes are debounced before rendering.
- Render status reports ready, rendering, or error.
- The status bar displays render duration in milliseconds.
- Stale render responses are discarded so older renders do not overwrite newer input.

## Ownership

This is app/server behavior. The render pipeline reads the textarea value and Pandoc
configuration. It no longer depends on editor-driven push synchronization.

## Keep

- Use one canonical debounce setting.
- Keep render ordering/version checks.
- Keep render duration visible.
- Keep tests focused on user-visible preview correctness and stale-render prevention.

## Candidate Enhancements

- Cancel in-flight render processes when a newer render starts.
- Render in a worker process or queue if Pandoc blocks other API requests.
- Add diagnostics for slow filters/templates.
- Split command configuration from runtime render state.

## Non-Goals

- Incremental markdown rendering
- Replacing Pandoc
- Rendering from disk when the textarea has unsaved edits
