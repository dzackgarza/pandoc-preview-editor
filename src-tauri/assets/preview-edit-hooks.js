(function() {
  /**
   * Pandoc-Preview Preview Hooks
   *
   * Modular library for handling interactivity within the preview iframe.
   * This is a content-layer responsibility injected via Pandoc templates.
   */

  function init() {
    // Find all elements tagged with the canonical 'pandoc-preview-editable' hook
    const editables = document.querySelectorAll('.pandoc-preview-editable, img, embed');

    editables.forEach(el => {
      // Use the explicit 'data-edit-kind' or infer from tag name
      const kind = el.getAttribute('data-edit-kind') || el.tagName.toLowerCase();
      
      // Determine the source path/identifier
      let sourcePath = null;
      if (el.tagName === 'IMG' || el.tagName === 'EMBED') {
        const src = el.getAttribute('src') || '';
        try {
          const url = new URL(src, window.location.origin);
          if (url.pathname.startsWith('/api/figures/serve')) {
            sourcePath = url.searchParams.get('path');
          } else {
            sourcePath = decodeURIComponent(url.pathname);
          }
        } catch (e) {
          sourcePath = src;
        }
      }

      // If we can't find a source path, this isn't an editable file asset
      if (!sourcePath && kind !== 'tikzcd' && kind !== 'tikzpic' && kind !== 'tikzcode') return;

      setupHover(el, { kind, path: sourcePath });
    });
  }

  function setupHover(el, metadata) {
    let activeOverlay = null;

    el.addEventListener('mouseenter', () => {
      if (activeOverlay) return;

      const overlay = document.createElement('div');
      overlay.className = 'pandoc-preview-edit-overlay';
      overlay.textContent = 'Edit ⚙️';

      // Position relative to element
      const rect = el.getBoundingClientRect();
      const scrollX = window.scrollX || document.documentElement.scrollLeft;
      const scrollY = window.scrollY || document.documentElement.scrollTop;

      overlay.style.left = (rect.right + scrollX - 60) + 'px';
      overlay.style.top = (rect.top + scrollY + 8) + 'px';

      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        // Dispatch postMessage to parent React window
        window.parent.postMessage({
          type: 'pandoc-preview-edit',
          ...metadata
        }, '*');
      });

      document.body.appendChild(overlay);
      activeOverlay = overlay;
    });

    el.addEventListener('mouseleave', (e) => {
      // Small delay to allow moving to the overlay itself
      setTimeout(() => {
        if (activeOverlay && !activeOverlay.matches(':hover') && !el.matches(':hover')) {
          activeOverlay.remove();
          activeOverlay = null;
        }
      }, 100);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
