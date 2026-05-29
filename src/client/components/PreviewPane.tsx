import * as React from 'react';
import { PaneHeader } from './PaneHeader.jsx';

export function PreviewPane({ html }: { html: string }) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const processIframe = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      // Forward keydown events from the iframe to the parent window so keyboard shortcuts work uniformly.
      const win = doc.defaultView;
      if (win && !(win as any).__KEY_FORWARDING_ATTACHED__) {
        (win as any).__KEY_FORWARDING_ATTACHED__ = true;
        win.addEventListener('keydown', (e: KeyboardEvent) => {
          if (window.parent) {
            window.parent.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey,
                altKey: e.altKey,
                bubbles: true,
                cancelable: true,
              })
            );
          }
        }, { capture: true });
      }

      // Find all potential TikZ elements rendered by Pandoc
      const tikzElements = doc.querySelectorAll(
        'pre.tikz, pre.sourceCode.tikz, code.tikz, code.language-tikz'
      );
      if (tikzElements.length > 0) {
        tikzElements.forEach((el) => {
          let container = el;
          if (el.tagName === 'CODE' && el.parentElement && el.parentElement.tagName === 'PRE') {
            container = el.parentElement;
          }
          if (container.parentElement && container.parentElement.classList.contains('sourceCode')) {
            container = container.parentElement;
          }

          let code = el.textContent || '';
          // Strip any non-breaking spaces or trim lines
          code = code.replace(/&nbsp;/g, ' ').trim();
          
          // Ensure it is wrapped in \begin{document} and \end{document} if missing
          if (!code.includes('\\begin{document}')) {
            code = `\\begin{document}\n${code}\n\\end{document}`;
          }

          const script = doc.createElement('script');
          script.type = 'text/tikz';
          script.textContent = code;

          container.replaceWith(script);
        });

        // Inject fonts CSS if not already present
        if (!doc.querySelector('link[href*="fonts.css"]')) {
          const link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://tikzjax.com/v1/fonts.css';
          doc.head.appendChild(link);
        }

        // Inject tikzjax JS if not already present
        if (!doc.querySelector('script[src*="tikzjax.js"]')) {
          const script = doc.createElement('script');
          script.src = 'https://tikzjax.com/v1/tikzjax.js';
          script.onload = () => {
            const win = doc.defaultView as any;
            if (win) {
              if (typeof win.processTikZ === 'function') {
                win.processTikZ();
              }
              // Manually dispatch DOMContentLoaded and load to trigger page-load event listeners
              doc.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
              win.dispatchEvent(new Event('DOMContentLoaded'));
              doc.dispatchEvent(new Event('load', { bubbles: true }));
              win.dispatchEvent(new Event('load'));
            }
          };
          doc.head.appendChild(script);
        } else {
          const win = doc.defaultView as any;
          if (win) {
            if (typeof win.processTikZ === 'function') {
              win.processTikZ();
            }
            // Manually dispatch DOMContentLoaded and load
            doc.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
            win.dispatchEvent(new Event('DOMContentLoaded'));
            doc.dispatchEvent(new Event('load', { bubbles: true }));
            win.dispatchEvent(new Event('load'));
          }
        }
      }

      // Inject Hover-to-Edit Overlays on Preview Images
      if (win) {
        const editableElements = doc.querySelectorAll('img, embed');
        editableElements.forEach((el) => {
          const srcAttr = el.tagName === 'EMBED' ? 'src' : 'src';
          const srcValue = el.getAttribute(srcAttr) || '';
          
          let figurePath: string | null = null;
          try {
            const url = new URL(srcValue, window.location.origin);
            if (url.pathname.includes('/api/preview-assets') || url.pathname.includes('/api/figures/serve')) {
              figurePath = url.searchParams.get('path');
            }
          } catch (err) {
            console.error('URL parsing error:', err);
          }

          if (!figurePath) {
            if (srcValue.includes('/central-figures/') || srcValue.includes('.pandoc/figures')) {
              figurePath = srcValue;
            }
          }

          if (!figurePath) return;

          // Ensure we don't attach multiple times
          if ((el as any).__HOVER_EDIT_ATTACHED__) return;
          (el as any).__HOVER_EDIT_ATTACHED__ = true;

          let activeOverlay: HTMLDivElement | null = null;
          let removeTimeout: any = null;

          const createOverlay = () => {
            if (activeOverlay) return;
            if (removeTimeout) {
              clearTimeout(removeTimeout);
              removeTimeout = null;
            }

            const overlay = doc.createElement('div');
            overlay.className = 'pandoc-preview-hover-edit';
            overlay.textContent = 'Edit ⚙️';
            
            // Gorgeous premium glassmorphic styling
            Object.assign(overlay.style, {
              position: 'absolute',
              background: 'rgba(30, 34, 43, 0.85)',
              backdropFilter: 'blur(4px)',
              border: '1px solid #2b2f38',
              color: '#8fb8ff',
              fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: '11px',
              fontWeight: '600',
              padding: '4px 8px',
              borderRadius: '6px',
              cursor: 'pointer',
              zIndex: '10000',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
              transition: 'all 0.15s ease',
              pointerEvents: 'auto',
            });

            // Position overlay relative to the image element
            const rect = el.getBoundingClientRect();
            const scrollX = win.scrollX || doc.documentElement.scrollLeft;
            const scrollY = win.scrollY || doc.documentElement.scrollTop;
            
            // Place overlay at top-right of image
            overlay.style.left = `${rect.right + scrollX - 70}px`;
            overlay.style.top = `${rect.top + scrollY + 8}px`;

            overlay.addEventListener('mouseenter', () => {
              if (removeTimeout) {
                clearTimeout(removeTimeout);
                removeTimeout = null;
              }
            });

            overlay.addEventListener('mouseleave', () => {
              removeOverlay();
            });

            overlay.addEventListener('click', (e) => {
              e.stopPropagation();
              fetch('/api/diagram/launch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ absolutePath: figurePath }),
              }).catch(console.error);
            });

            doc.body.appendChild(overlay);
            activeOverlay = overlay;
          };

          const removeOverlay = () => {
            if (removeTimeout) clearTimeout(removeTimeout);
            removeTimeout = setTimeout(() => {
              if (activeOverlay) {
                activeOverlay.remove();
                activeOverlay = null;
              }
            }, 150);
          };

          el.addEventListener('mouseenter', createOverlay);
          el.addEventListener('mouseleave', removeOverlay);
        });
      }
    };

    // Run immediately since the iframe may have already loaded
    processIframe();

    iframe.addEventListener('load', processIframe);
    return () => {
      iframe.removeEventListener('load', processIframe);
    };
  }, [html]);

  return (
    <section
      id="preview-pane"
      className="flex h-full min-w-0 flex-col bg-[#f7f7f4]"
      data-testid="preview-pane"
    >
      <PaneHeader title="Preview" detail="Pandoc HTML" light />
      <div className="min-h-0 flex-1 p-5">
        <iframe
          ref={iframeRef}
          id="preview"
          data-testid="preview"
          sandbox="allow-scripts allow-same-origin"
          srcDoc={html}
          title="Pandoc preview"
        />
      </div>
    </section>
  );
}


