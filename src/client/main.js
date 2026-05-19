const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const statusEl = document.getElementById('status');
const durationEl = document.getElementById('duration');

let renderVersion = 0;
let debounceTimer = null;
let currentFile = window.__INITIAL_FILE || null;

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
      if (data.durationMs != null) {
        durationEl.textContent = `${data.durationMs}ms`;
      }
    } else {
      preview.srcdoc = `<html><body style="color:#f48771;padding:2em">Render failed</body></html>`;
      setStatus('error', 'error');
    }
  } catch (err) {
    if (version !== renderVersion) return;
    preview.srcdoc = `<html><body style="color:#f48771;padding:2em">Error: ${err.message}</body></html>`;
    setStatus('error', 'error');
  }
}

async function doSave(markdown) {
  let filePath = currentFile;

  // No file associated yet — prompt user for a path
  if (!filePath) {
    filePath = window.prompt('Save as (absolute path):');
    if (!filePath) return; // user cancelled
  }

  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown, path: filePath }),
    });
    if (!res.ok) {
      const data = await res.json();
      setStatus(`save failed: ${data.error}`, 'error');
    } else {
      currentFile = filePath;
      setStatus('saved', 'ok');
    }
  } catch (err) {
    setStatus(`save error: ${err.message}`, 'error');
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

// Load initial content if provided by the server
if (window.__INITIAL_CONTENT) {
  editor.value = window.__INITIAL_CONTENT;
}

// Initial render from whatever content is in the editor
scheduleRender();

// Re-render on input
editor.addEventListener('input', scheduleRender);

// Ctrl+S for immediate render + save
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (debounceTimer) clearTimeout(debounceTimer);
    const version = ++renderVersion;
    const text = editor.value;
    doRender(text, version);
    doSave(text);
  }
});
