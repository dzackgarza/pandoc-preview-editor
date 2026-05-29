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
      if (tikzElements.length === 0) return;

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


