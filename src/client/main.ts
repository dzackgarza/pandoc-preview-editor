const editor = document.getElementById('editor') as HTMLTextAreaElement;
const preview = document.getElementById('preview') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const durationEl = document.getElementById('duration') as HTMLSpanElement;

let renderVersion = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(text: string, className: string) {
  statusEl.textContent = text;
  statusEl.className = className;
}

async function doRender(markdown: string, version: number) {
  setStatus('rendering...', 'loading');

  try {
    const res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });

    if (!res.ok) {
      throw new Error(`server returned ${res.status}`);
    }

    const data = await res.json();

    // Discard stale responses
    if (version !== renderVersion) return;

    if (data.ok) {
      preview.innerHTML = data.html;
      setStatus('ready', 'ok');
    } else {
      preview.innerHTML = `<div style="color:#f48771">Render failed</div>`;
      setStatus('error', 'error');
    }

    if (data.durationMs != null) {
      durationEl.textContent = `${data.durationMs}ms`;
    }
  } catch (err) {
    if (version !== renderVersion) return;
    preview.innerHTML = `<div style="color:#f48771">Error: ${(err as Error).message}</div>`;
    setStatus('error', 'error');
  }
}

function scheduleRender() {
  const version = ++renderVersion;
  const text = editor.value;

  if (debounceTimer) clearTimeout(debounceTimer);

  // Parse debounce from a meta tag or default to 400ms
  const debounceMs = parseInt(
    document.querySelector('meta[name="debounce-ms"]')?.getAttribute('content') ??
      '400',
    10,
  );

  debounceTimer = setTimeout(() => doRender(text, version), debounceMs);
}

// Initial render from placeholder/default content
editor.addEventListener('input', scheduleRender);

// Ctrl+S for immediate render
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (debounceTimer) clearTimeout(debounceTimer);
    const version = ++renderVersion;
    doRender(editor.value, version);
  }
});

// Resizer drag
const resizer = document.getElementById('resizer') as HTMLDivElement;
const editorPane = document.getElementById('editor-pane') as HTMLDivElement;
const previewPane = document.getElementById('preview-pane') as HTMLDivElement;
let isDragging = false;

resizer.addEventListener('mousedown', (e) => {
  isDragging = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const split = document.getElementById('split') as HTMLDivElement;
  const splitRect = split.getBoundingClientRect();
  const x = e.clientX - splitRect.left;
  const pct = (x / splitRect.width) * 100;
  // Clamp between 20% and 80%
  const clamped = Math.max(20, Math.min(80, pct));
  editorPane.style.flex = `0 0 ${clamped}%`;
  previewPane.style.flex = `1 1 ${100 - clamped}%`;
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// Trigger initial render if there's placeholder content
scheduleRender();
