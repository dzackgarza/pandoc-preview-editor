const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const statusEl = document.getElementById('status');
const durationEl = document.getElementById('duration');

let renderVersion = 0;
let debounceTimer = null;

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = className;
}

async function doRender(markdown, version) {
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
      preview.srcdoc = data.html;
      setStatus('ready', 'ok');
    } else {
      preview.srcdoc = `<html><body style="color:#f48771;padding:2em">Render failed</body></html>`;
      setStatus('error', 'error');
    }

    if (data.durationMs != null) {
      durationEl.textContent = `${data.durationMs}ms`;
    }
  } catch (err) {
    if (version !== renderVersion) return;
    preview.srcdoc = `<html><body style="color:#f48771;padding:2em">Error: ${err.message}</body></html>`;
    setStatus('error', 'error');
  }
}

function scheduleRender() {
  const version = ++renderVersion;
  const text = editor.value;

  if (debounceTimer) clearTimeout(debounceTimer);

  // Parse debounce from a meta tag or default to 400ms
  const meta = document.querySelector('meta[name="debounce-ms"]');
  const debounceMs = parseInt(meta?.getAttribute('content') ?? '400', 10);

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

// Schedule initial render
scheduleRender();
