import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type RenderStatus = 'idle' | 'rendering' | 'error';

const DEBOUNCE_MS = 400;

export function useRenderer(markdownText: string, currentFile: string | null, config: any) {
  const [previewHtml, setPreviewHtml] = useState('');
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<{
    summary: string;
    detail: string;
  } | null>(null);
  const renderVersion = useRef(0);
  const debounceTimer = useRef<number | null>(null);

  const clearRenderTimer = useCallback(() => {
    if (debounceTimer.current != null) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  const doRender = useCallback(async (text: string, version: number) => {
    setStatus('rendering');
    try {
      const data = await invoke<{
        html: string;
        stderr: string;
      }>('render', { markdown: text });

      if (version !== renderVersion.current) return;

      setPreviewHtml(data.html);
      setStatus('idle');
      setDurationMs(null);
      setDiagnostics(null);
    } catch (err) {
      if (version !== renderVersion.current) return;
      
      let detail = String(err);
      let summary = 'Renderer Error';
      
      if (typeof err === 'object' && err !== null) {
        const errorObj = err as { message?: string; stderr?: string };
        detail = errorObj.stderr || errorObj.message || 'Unknown render error';
        if (errorObj.message) summary = errorObj.message;
      }

      setStatus('error');
      setDiagnostics({
        summary,
        detail,
      });
    }
  }, []);

  const renderImmediate = useCallback(
    (text: string) => {
      clearRenderTimer();
      const version = ++renderVersion.current;
      void doRender(text, version);
    },
    [clearRenderTimer, doRender],
  );

  const scheduleRender = useCallback(
    (text: string) => {
      clearRenderTimer();
      const version = ++renderVersion.current;
      debounceTimer.current = window.setTimeout(() => {
        void doRender(text, version);
      }, DEBOUNCE_MS);
    },
    [clearRenderTimer, doRender],
  );

  useEffect(() => {
    scheduleRender(markdownText);
    return clearRenderTimer;
  }, [clearRenderTimer, markdownText, scheduleRender]);

  return {
    previewHtml,
    status,
    durationMs,
    diagnostics,
    setDiagnostics,
    renderImmediate,
    scheduleRender,
  };
}
