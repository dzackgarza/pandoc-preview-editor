# Feature: Display Last Compilation Time in ms

## Problem

Users have no feedback on how long pandoc rendering takes.
A slow render (~500ms+) feels like the app is hung.
Showing the elapsed time gives users:
- Visibility into whether the current document is slow to render
- A way to tell if a render is still in progress vs.
  completed
- Debugging data when investigating performance issues

## Can This Already Be Done?

No. The render time is computed by the app/server Pandoc pipeline. Firenvim only edits
the textarea and has no render-timing state.
This is an app-side display feature.

## Proposed Solution

Display the last pandoc render duration in milliseconds in the GUI status bar.

### Architecture

Server-side:
- The render handler (`server/index.ts` or `server/render.ts`) already has a timestamp
  for when it starts rendering
- Add an end timestamp after pandoc completes
- Compute duration = end - start in ms
- Include the duration value in the WebSocket message sent to the client

Client-side:
- The WebSocket message handler in `web/` stores the last render duration
- A status bar element displays: `Render: 142ms`
- During an active render (pandoc running, no response yet), display: `Render: ...`
  (indeterminate)

### Message Protocol Change

Current WebSocket messages likely contain just the HTML string.
Change to:

```json
{
  "type": "preview-update",
  "html": "...",
  "renderTimeMs": 142,
  "seq": 12
}
```

### UI Placement

A small status bar at the bottom of the preview pane, or inline in the header bar next
to other indicators.

Example layout:

```
[Refresh] [Render: 142ms] [Last saved: 12s ago] [Unsaved changes]
```

### Minimal Viable Implementation

1. Add `const start = performance.now()` before the pandoc call
2. Add `const renderTimeMs = Math.round(performance.now() - start)` after
3. Include in the broadcast message
4. Client stores and displays the value
5. Periodic server heartbeat / ping could reset the display after inactivity

## Human Decisions Needed

1. **Placement**: Status bar vs.
   header bar vs. tooltip on refresh button.
   Status bar is recommended for consistency with other editor UIs.
2. **Precision**: Integer ms (enough for MVP) vs.
   fractional ms (noise).
3. **History**: Show only last render time, or a rolling window / sparkline?
   MVP is single value.

## Future Possibilities

- Warning color when render time exceeds 500ms
- Sparkline of recent render times
- Show render time on hover over a status indicator
