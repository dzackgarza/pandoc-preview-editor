import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PaneHeader } from './PaneHeader.jsx';
import { toast } from '../lib/toast.js';

export function PreviewPane({ html }: { html: string }) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const forwardedWindowsRef = React.useRef<WeakSet<Window>>(new WeakSet());
  const hoverAttachedElementsRef = React.useRef<WeakSet<Element>>(new WeakSet());

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const processIframe = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      // Forward keydown events from the iframe to the parent window so keyboard shortcuts work uniformly.
      const win = doc.defaultView;
      if (win && !forwardedWindowsRef.current.has(win)) {
        forwardedWindowsRef.current.add(win);
        win.addEventListener(
          'keydown',
          (e: KeyboardEvent) => {
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
                }),
              );
            }
          },
          { capture: true },
        );
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
            if (url.pathname.startsWith('/api/preview-assets/')) {
              figurePath = decodeURIComponent(
                url.pathname.replace('/api/preview-assets/', ''),
              );
            } else if (url.pathname.startsWith('/api/figures/serve')) {
              figurePath = url.searchParams.get('path');
            } else {
              // Direct absolute path or relative web path
              figurePath = decodeURIComponent(url.pathname);
            }
          } catch (err) {
            figurePath = srcValue;
          }

          if (!figurePath) return;

          // Ensure we don't attach multiple times
          if (hoverAttachedElementsRef.current.has(el)) return;
          hoverAttachedElementsRef.current.add(el);

          let activeOverlay: HTMLDivElement | null = null;
          let removeTimeout: ReturnType<typeof setTimeout> | null = null;

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
              invoke('launch_diagram', { absolutePath: figurePath }).catch((err: unknown) => {
                toast({
                  title: 'Open figure failed',
                  description: err instanceof Error ? err.message : String(err),
                  variant: 'destructive',
                });
              });
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
