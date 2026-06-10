import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PaneHeader } from './PaneHeader.jsx';
import { toast } from '../lib/toast.js';

export function PreviewPane({ html, error }: { html: string; error?: string | null }) {
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
      className="flex h-full min-w-0 flex-col bg-[#f7f7f4] relative"
      data-testid="preview-pane"
    >
      <PaneHeader title="Preview" detail="Pandoc HTML" light />
      <div className="min-h-0 flex-1 p-5 relative">
        <iframe
          ref={iframeRef}
          id="preview"
          data-testid="preview"
          sandbox="allow-scripts allow-same-origin"
          srcDoc={html}
          title="Pandoc preview"
          className="w-full h-full border-none"
        />
        {error ? (
          <div className="absolute inset-0 bg-[#f7f7f4] p-8 overflow-auto z-10 text-[#b42318] font-mono text-sm whitespace-pre-wrap">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}

