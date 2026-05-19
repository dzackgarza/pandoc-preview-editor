
The principled approach is to make “seeing the GUI” part of the test harness, not a human-side debugging activity. The agent should run the app, collect visual and non-visual evidence, inspect that evidence itself, and fail with a structured diagnosis. The uploaded traces show why this matters: the agent reasoned from internal xterm implementation details, contradicted itself about `.xterm-rows` having content versus being blank, and earlier treated production-path failures as environmental blockers without isolating smaller layers. Those are process failures, not just code bugs.   

There should be two certification modes.

## 1. When a vision/multimodal model is available

This is the closest analog to a human looking at the screen. The agent should not merely take a screenshot and tell the user to inspect it. It should take the screenshot, open/read it itself, and compare it against explicit visual expectations.

The E2E flow should be:

```text
start app with a fresh file
open browser via Playwright
wait for nvim socket readiness
take screenshot of full page
take screenshot of terminal pane only
take screenshot of preview pane only
agent inspects screenshots
agent writes a structured verdict
test also asserts process/socket/DOM/file facts
```

The visual assertions should be concrete:

```text
terminal pane:
  not blank
  contains visible terminal rows
  visible nvim statusline or filename
  cursor/status region visible
  no full-pane overlay covering terminal
  terminal text is not same color as background

preview pane:
  not blank
  contains rendered heading
  contains rendered math/citation where applicable
  not showing stale previous document
  not showing only a loading spinner

layout:
  two panes visible
  no pane has zero size
  terminal pane is not hidden behind preview
  preview iframe is not collapsed
```

The agent should produce a visual report like:

```json
{
  "test": "cert_initial_terminal_paints",
  "screenshots": {
    "full": "artifacts/cert_initial/full.png",
    "terminal": "artifacts/cert_initial/terminal.png",
    "preview": "artifacts/cert_initial/preview.png"
  },
  "vision_verdict": {
    "terminal_visible": true,
    "terminal_blank": false,
    "nvim_statusline_visible": true,
    "preview_visible": true,
    "preview_blank": false,
    "layout_ok": true
  },
  "nonvisual_crosschecks": {
    "nvim_socket_ready": true,
    "xterm_buffer_has_text": true,
    "terminal_dom_has_text": true,
    "preview_dom_has_heading": true
  }
}
```

A vision model is especially valuable for bugs like the one you described:

```text
DOM/buffer may contain text,
but the user sees a blank pane until Hyprland workspace switch.
```

A DOM-only test can easily pass there. A screenshot-aware agent can say: “xterm buffer contains text, `.xterm-rows` contains text, but the screenshot is visually blank.” That immediately narrows the problem to paint/compositor/CSS/layout rather than PTY data flow.

Playwright should be the base harness. Its trace viewer records test actions and lets you inspect traces after the run; Playwright explicitly supports saved traces for CI debugging. ([Playwright][1]) Playwright also supports screenshot comparisons through `expect(page).toHaveScreenshot()`, and its docs note that rendering can vary by OS, browser, hardware, headless mode, and fonts, so baselines must be generated in a controlled environment. ([Playwright][2])

The agent should use these artifacts automatically:

```ts
await page.screenshot({ path: `${dir}/full.png`, fullPage: true });
await page.getByTestId('terminal-pane').screenshot({ path: `${dir}/terminal.png` });
await page.getByTestId('preview-pane').screenshot({ path: `${dir}/preview.png` });

await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
// ...
await context.tracing.stop({ path: `${dir}/trace.zip` });
```

For the vision-enabled mode, the certification rule should be:

```text
A test cannot be marked visually correct unless the agent has inspected the actual screenshot artifact and written a verdict tied to that artifact.
```

Not acceptable:

```text
“Playwright says the locator is visible.”
“textContent is nonempty.”
“trace exists.”
```

Acceptable:

```text
“terminal.png visibly contains rows of terminal text and a nvim statusline; preview.png visibly contains the heading rendered from the test document.”
```

The vision model should also inspect failure screenshots before modifying code. The failure report should say:

```text
Observed screenshot:
  terminal pane black with no visible glyphs
  preview pane normal
Nonvisual state:
  xterm buffer first lines contain “test.md”
  DOM rows textContent contains “test.md”
Conclusion:
  data exists but paint is missing
Next layer:
  test CSS/computed style/pixel output, not nvim/socket
```

That prevents blind “maybe font, maybe PTY, maybe fit” mutations.

## 2. When no vision model is available

Without vision, the agent can still “see” a lot. It should collect four kinds of evidence:

```text
A. process evidence
B. terminal state evidence
C. DOM/layout/style evidence
D. screenshot-as-data evidence
```

The key is to treat the screenshot as a machine-readable image, even if no model can visually interpret it.

### A. Process evidence

The test should record:

```text
server pid
nvim pid
nvim argv
socket path
socket readiness result
pandoc version
browser version
```

Example assertions:

```ts
expect(processTree).toContainProcess(/nvim/);
expect(processTree).toContainArg('--listen');
expect(await remoteExpr(socket, '1')).toBe('1');
```

This proves the app started the real external machinery.

### B. Terminal state evidence

Expose a debug hook in development/test builds:

```ts
window.__debugTerminal = () => {
  const lines = [];
  for (let i = 0; i < Math.min(term.rows, 40); i++) {
    lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? null);
  }

  const rowsEl = document.querySelector('.xterm-rows');
  const screenEl = document.querySelector('.xterm-screen');
  const container = document.querySelector('[data-testid="terminal-pane"]');

  return {
    cols: term.cols,
    rows: term.rows,
    bufferLength: term.buffer.active.length,
    viewportY: term.buffer.active.viewportY,
    baseY: term.buffer.active.baseY,
    firstLines: lines,
    rowsText: rowsEl?.textContent ?? null,
    rects: {
      container: rect(container),
      screen: rect(screenEl),
      rows: rect(rowsEl),
    },
    styles: {
      container: styleSummary(container),
      screen: styleSummary(screenEl),
      rows: styleSummary(rowsEl),
    }
  };
};

function rect(el: Element | null) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function styleSummary(el: Element | null) {
  if (!el) return null;
  const s = getComputedStyle(el);
  return {
    display: s.display,
    visibility: s.visibility,
    opacity: s.opacity,
    color: s.color,
    backgroundColor: s.backgroundColor,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    position: s.position,
    overflow: s.overflow,
    zIndex: s.zIndex,
    transform: s.transform,
    clip: s.clip,
    clipPath: s.clipPath,
  };
}
```

xterm’s `IBufferLine` API exposes `translateToString`, which lets tests read terminal buffer lines directly. ([Xterm.js][3]) The xterm serialize addon is also useful: it serializes terminal rows into a string, and can also serialize as HTML. ([GitHub][4])

Use both:

```ts
const state = await page.evaluate(() => window.__debugTerminal());
expect(state.firstLines.join('\n')).toContain('NVIM_SENTINEL');
expect(state.rowsText).toContain('NVIM_SENTINEL');
```

If xterm buffer contains text but `.xterm-rows.textContent` does not, the issue is renderer/DOM synchronization.

If both contain text but screenshot metrics say blank, the issue is paint/CSS/compositor.

If neither contains text, the issue is PTY/WebSocket/input delivery.

### C. DOM/layout/style evidence

A rendering issue is often a layout issue. The agent should always dump:

```text
bounding boxes
computed styles
z-index/overlap data
elementFromPoint
visibility/display/opacity
font metrics
terminal cols/rows
container size
scroll positions
```

Example:

```ts
const layout = await page.evaluate(() => {
  const pane = document.querySelector('[data-testid="terminal-pane"]')!;
  const rows = document.querySelector('.xterm-rows');
  const screen = document.querySelector('.xterm-screen');

  const centerX = pane.getBoundingClientRect().left + pane.getBoundingClientRect().width / 2;
  const centerY = pane.getBoundingClientRect().top + pane.getBoundingClientRect().height / 2;
  const topEl = document.elementFromPoint(centerX, centerY);

  return {
    paneRect: rect(pane),
    rowsRect: rect(rows),
    screenRect: rect(screen),
    topElementAtPaneCenter: {
      tag: topEl?.tagName,
      className: (topEl as HTMLElement | null)?.className,
      testid: (topEl as HTMLElement | null)?.dataset?.testid
    },
    rowsStyle: styleSummary(rows),
    screenStyle: styleSummary(screen)
  };
});
```

This catches:

```text
terminal has zero size
rows are offscreen
rows are transparent
rows are covered by an overlay
rows have display:none/visibility:hidden
pane center is occupied by another element
font-size/line-height are zero
```

For the xterm initial-render bug, the agent should also capture time-series state:

```ts
for (const delay of [0, 50, 100, 250, 500, 1000, 2000]) {
  await page.waitForTimeout(delay);
  await dump(`t=${delay}`);
}
```

Each dump should include:

```text
xterm buffer lines
DOM rows text
rects
styles
screenshot pixel metrics
```

This replaces speculation with a timeline.

### D. Screenshot-as-data evidence

Even without a vision model, screenshots can be tested. The agent can compute:

```text
non-background pixel count
foreground/background color contrast
number of unique colors
bounding box of non-background pixels
image entropy
difference from blank baseline
difference from expected/golden screenshot
```

Use packages such as:

```text
pngjs
sharp
pixelmatch
ssim.js or resemblejs, if needed
```

`pixelmatch` is a small JS pixel-level image comparison library originally created to compare screenshots in tests. ([GitHub][5]) Playwright itself uses pixelmatch for screenshot comparisons and allows configuring diff thresholds. ([Playwright][2])

A simple “not blank” test:

```ts
import { PNG } from 'pngjs';

function imageStats(buffer: Buffer) {
  const png = PNG.sync.read(buffer);
  const counts = new Map<string, number>();

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const key = `${png.data[i]},${png.data[i+1]},${png.data[i+2]},${png.data[i+3]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0];
  const nonDominantPixels = png.width * png.height - dominant[1];

  return {
    width: png.width,
    height: png.height,
    uniqueColors: counts.size,
    dominantColor: dominant[0],
    nonDominantPixels,
    nonDominantRatio: nonDominantPixels / (png.width * png.height),
  };
}

test('terminal screenshot is not visually blank', async ({ page }) => {
  const shot = await page.getByTestId('terminal-pane').screenshot();
  const stats = imageStats(shot);

  expect(stats.uniqueColors).toBeGreaterThan(10);
  expect(stats.nonDominantRatio).toBeGreaterThan(0.01);
});
```

That is not as strong as vision, but it catches a black rectangle.

A stronger test compares two states:

```text
before typing screenshot
after nvim initial screen screenshot
after typing screenshot
```

Assertions:

```text
initial terminal screenshot differs from blank baseline;
after typing screenshot differs from before;
diff bounding box is inside terminal pane;
preview screenshot differs after markdown edit.
```

Using `pixelmatch`:

```ts
const diffPixels = pixelmatch(
  blank.data,
  actual.data,
  diff.data,
  width,
  height,
  { threshold: 0.1 }
);

expect(diffPixels).toBeGreaterThan(1000);
```

For the specific Hyprland/workspace issue, a useful non-vision test is:

```text
If terminal buffer has content and DOM rows have content,
then terminal screenshot must not be visually blank.
```

That is the key triage invariant.

```ts
const state = await page.evaluate(() => window.__debugTerminal());
expect(state.firstLines.join('\n')).toContain('NVIM_SENTINEL');

const shot = await terminal.screenshot();
const stats = imageStats(shot);
expect(stats.nonDominantRatio).toBeGreaterThan(0.01);
```

If that fails, the test has proven:

```text
not PTY;
not nvim;
not xterm buffer;
not DOM text;
actual visual paint is failing.
```

That is already a real diagnosis.

## Required logging discipline

The logs should be structured, written to files, read by the agent, and asserted in tests. Console spam is not enough.

Use JSONL:

```json
{"ts":1710000000.123,"event":"app.start","test":"cert_initial_render","file":"/tmp/doc.md"}
{"ts":1710000000.456,"event":"pty.spawn.start","argv":["nvim","--listen","/tmp/nvim.sock","/tmp/doc.md"]}
{"ts":1710000000.789,"event":"pty.spawn.success","pid":12345}
{"ts":1710000001.000,"event":"nvim.ready.success","socket":"/tmp/nvim.sock"}
{"ts":1710000001.100,"event":"xterm.open","container":{"w":640,"h":686}}
{"ts":1710000001.120,"event":"xterm.fit","cols":80,"rows":37,"cell":{"w":8,"h":18}}
{"ts":1710000001.130,"event":"pty.resize","cols":80,"rows":37}
{"ts":1710000001.200,"event":"xterm.write","bytes":4096}
{"ts":1710000001.220,"event":"xterm.write_parsed","bufferHash":"..."}
{"ts":1710000001.250,"event":"xterm.render","start":0,"end":36}
{"ts":1710000001.300,"event":"screenshot.stats","target":"terminal","uniqueColors":52,"nonDominantRatio":0.034}
```

Every test should write an artifact directory:

```text
artifacts/<test-name>/
  trace.jsonl
  browser-console.jsonl
  network.jsonl
  process-tree.txt
  terminal-debug-t0.json
  terminal-debug-t500.json
  terminal-debug-t2000.json
  full.png
  terminal.png
  preview.png
  terminal-diff.png
  preview.html
  nvim-buffer.txt
  disk-file.md
  verdict.json
```

The agent must read these files itself before changing code. The process should be:

```text
run failing test
open trace.jsonl
open terminal-debug snapshots
open screenshot stats
if vision is available, inspect PNGs
classify failure into one layer
only then modify code
rerun the single failing test
compare new artifacts to old artifacts
```

The classification should be mechanical:

```text
Case 1:
  nvim socket not ready
  => process/socket failure

Case 2:
  nvim buffer lacks sentinel
  => keyboard/PTTY/input failure

Case 3:
  nvim buffer has sentinel, xterm buffer lacks it
  => PTY->xterm delivery failure

Case 4:
  xterm buffer has sentinel, DOM rows lack it
  => xterm renderer/DOM failure

Case 5:
  DOM rows have sentinel, screenshot blank
  => CSS/paint/compositor failure

Case 6:
  screenshot has terminal text, preview DOM blank
  => pandoc/render/WebSocket/iframe failure

Case 7:
  preview DOM correct, screenshot preview blank
  => preview CSS/paint/iframe visibility failure

Case 8:
  preview correct, disk stale after save
  => save/sync ordering failure
```

This prevents guessing.

## Concrete tests the agent should write

### Visual-enabled test

```ts
test('vision: initial terminal is visibly painted', async ({ page }) => {
  await page.goto(appUrl);
  await expect.poll(() => status()).toMatchObject({ nvimReady: true });

  const terminalPath = artifact('terminal.png');
  await page.getByTestId('terminal-pane').screenshot({ path: terminalPath });

  const debug = await page.evaluate(() => window.__debugTerminal());
  writeJson(artifact('terminal-debug.json'), debug);

  // Agent/vision step:
  // Open terminal.png and classify:
  //   blank / painted / occluded / zero-size / text invisible
  const visualVerdict = await inspectImageWithVisionModel(terminalPath, {
    expected: 'A visible terminal with nvim screen text/statusline, not a blank rectangle.'
  });

  expect(debug.firstLines.join('\n')).toMatch(/nvim|NORMAL|doc\.md/i);
  expect(visualVerdict.terminalPainted).toBe(true);
});
```

### Non-vision equivalent

```ts
test('nonvision: xterm buffer, DOM, and pixels agree', async ({ page }) => {
  await page.goto(appUrl);
  await expect.poll(() => status()).toMatchObject({ nvimReady: true });

  const state = await page.evaluate(() => window.__debugTerminal());
  writeJson(artifact('terminal-debug.json'), state);

  expect(state.firstLines.join('\n')).toMatch(/nvim|NORMAL|doc\.md/i);
  expect(state.rowsText).toMatch(/nvim|NORMAL|doc\.md/i);

  const shot = await page.getByTestId('terminal-pane').screenshot();
  const stats = imageStats(shot);
  writeJson(artifact('terminal-screenshot-stats.json'), stats);

  expect(stats.uniqueColors).toBeGreaterThan(10);
  expect(stats.nonDominantRatio).toBeGreaterThan(0.01);

  expect(state.rects.container.width).toBeGreaterThan(100);
  expect(state.rects.container.height).toBeGreaterThan(100);
  expect(state.styles.rows.visibility).toBe('visible');
  expect(Number(state.styles.rows.opacity)).toBeGreaterThan(0.5);
});
```

### Timeline test for the missing-initial-render bug

```ts
test('initial render timeline is observable', async ({ page }) => {
  await page.goto(appUrl);

  const checkpoints = [0, 50, 100, 250, 500, 1000, 2000];

  for (const ms of checkpoints) {
    await page.waitForTimeout(ms);
    const state = await page.evaluate(() => window.__debugTerminal());
    const shot = await page.getByTestId('terminal-pane').screenshot();
    const stats = imageStats(shot);

    writeJson(artifact(`terminal-${ms}.json`), { state, stats });
  }

  const final = readJson(artifact('terminal-2000.json'));

  expect(final.state.firstLines.join('\n')).toMatch(/nvim|NORMAL|doc\.md/i);
  expect(final.stats.nonDominantRatio).toBeGreaterThan(0.01);
});
```

If this fails, the artifact sequence tells the agent whether content appeared in buffer before pixels, whether DOM appeared before pixels, or whether nothing appeared at all.

## Tools/packages worth adding

For the web/xterm/Pandoc app:

```text
@playwright/test
Playwright trace viewer
pngjs
pixelmatch
sharp
@xterm/addon-serialize
pidtree or ps-tree
execa
pino or pino-pretty
zod for validating trace event schemas
axe-core/playwright only for accessibility checks, not visual proof
```

For visual debugging:

```text
Playwright screenshots and videos
Playwright trace.zip
pixelmatch diffs
screenshot stats
optional multimodal/vision inspection step
```

For terminal-specific debugging:

```text
xterm buffer dump via term.buffer.active.getLine(i).translateToString(true)
@xterm/addon-serialize for terminal text/HTML serialization
xterm event logs: onWriteParsed, onRender, onResize, onData
PTY byte counters and resize logs
```

For OS/process debugging:

```text
pidtree / ps-tree
lsof for socket/file ownership
ss or netstat for socket existence
strace only when process launch or socket behavior is unclear
```

For browser-level debugging:

```text
Playwright trace viewer
page.on('console')
page.on('pageerror')
page.on('requestfailed')
network HAR where useful
computed-style dumps
DOM snapshots
```

## What agents should not do

```text
Do not infer renderer failure from minified xterm internals alone.
Do not add random setTimeout/focus/refresh calls without before/after evidence.
Do not accept `.textContent` as proof of visual paint.
Do not accept screenshot existence as proof of nonblank rendering.
Do not make users report console logs.
Do not summarize “it looks like a font issue” unless the trace shows font/measurement facts.
Do not mark an E2E test green if it bypasses the real terminal/PTY/nvim path.
```

## The core discipline

Every failure should be reduced to a table like this:

```text
Layer                         Evidence                         Result
process: nvim running          process-tree.txt                 pass
socket: remote-expr            trace event nvim.ready.success   pass
nvim buffer                    nvim-buffer.txt                  pass
xterm buffer                   terminal-debug.json              pass
xterm DOM rows                 terminal-debug.json              pass
terminal pixels                terminal.png stats / vision      fail
preview DOM                    preview.html                     n/a
disk file                      disk-file.md                     n/a

Classification:
  CSS/paint/compositor/terminal-render invalidation bug.
Not:
  nvim startup bug
  PTY bug
  socket bug
  keyboard-input bug
```

That is how an agent tests the GUI itself. It does not guess. It collects independent witnesses, reads them, classifies the failing layer, and only then changes code.

[1]: https://playwright.dev/docs/trace-viewer "Trace viewer | Playwright"
[2]: https://playwright.dev/docs/test-snapshots "Visual comparisons | Playwright"
[3]: https://xtermjs.org/docs/api/terminal/interfaces/ibufferline/ "IBufferLine"
[4]: https://github.com/xtermjs/xterm.js/blob/master/addons/addon-serialize/typings/addon-serialize.d.ts "xterm.js/addons/addon-serialize/typings/addon-serialize.d.ts at master · xtermjs/xterm.js · GitHub"
[5]: https://github.com/mapbox/pixelmatch "GitHub - mapbox/pixelmatch: The smallest, simplest and fastest JavaScript pixel-level image comparison library · GitHub"
