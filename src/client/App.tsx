import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { GripVertical } from 'lucide-react';
import { EditorView } from '@codemirror/view';
import * as Tooltip from '@radix-ui/react-tooltip';

import { cn, lineCount } from './lib/utils.js';
import { useToast, toast } from './lib/toast.js';

// Import sub-components
import { TopMenuBar } from './components/TopMenuBar.jsx';
import { ExplorerDrawer } from './components/ExplorerDrawer.jsx';
import { EditorPane } from './components/EditorPane.jsx';
import { PreviewPane } from './components/PreviewPane.jsx';
import { StatusCluster } from './components/StatusCluster.jsx';
import { FileSelectorDialog } from './components/FileSelectorDialog.jsx';
import { QuickOpenDialog } from './components/QuickOpenDialog.jsx';
import { Toaster } from './components/Toaster.jsx';
import { SettingsDialog } from './components/SettingsDialog.jsx';
import { FilterSettingsModal } from './components/FilterSettingsModal.jsx';
import { DiagramModal } from './components/DiagramModal.jsx';

export type RenderStatus = 'ready' | 'rendering' | 'error' | 'saved';
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
export type PluginState = 'idle' | 'running' | 'complete' | 'error';

export type FileEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
};

export type OpenFileResult = {
  path: string;
  absolutePath: string;
  content: string;
};

export type QuickOpenEntry = {
  path: string;
  absolutePath: string;
  name: string;
  dir: string;
  recent: boolean;
};

export type PluginMetadata = {
  id: string;
  name: string;
  description: string;
  category: string;
};

declare global {
  interface Window {
    __INITIAL_CONTENT?: string;
    __INITIAL_FILE?: string | null;
    __TEMP_BACKUP_FILE?: string | null;
    __WORKSPACE_ROOT?: string;
    __IS_TEMP_FILE?: boolean;
    __PANDOC_PREVIEW_STATE__?: {
      markdown: string;
      currentFile: string | null;
    };
  }
}

const DEBOUNCE_MS = 400;
const RESET_LAYOUT = {
  'editor-pane-panel': 56,
  'preview-pane-panel': 44,
};

export function App() {
  const initialContent = window.__INITIAL_CONTENT ?? '';
  const [markdownText, setMarkdownText] = useState(initialContent);
  const [currentFile, setCurrentFile] = useState<string | null>(
    window.__INITIAL_FILE ?? null,
  );
  const [isTempFile, setIsTempFile] = useState(window.__IS_TEMP_FILE ?? false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [status, setStatus] = useState<RenderStatus>('ready');
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<{ summary: string; detail: string } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pluginState, setPluginState] = useState<PluginState>('idle');
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [saveAsDialogMode, setSaveAsDialogMode] = useState<'save' | 'new'>('save');
  const [workspaceRoot, setWorkspaceRoot] = useState(window.__WORKSPACE_ROOT ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterSettingsOpen, setFilterSettingsOpen] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const renderVersion = useRef(0);
  const debounceTimer = useRef<number | null>(null);
  const groupRef = useGroupRef();
  const editorViewRef = useRef<EditorView | null>(null);
  const saveAsInputRef = useRef<HTMLInputElement>(null);
  const quickOpenInputRef = useRef<HTMLInputElement>(null);
  const saveAsResolveRef = useRef<((path: string | null) => void) | null>(null);

  useEffect(() => {
    window.__PANDOC_PREVIEW_STATE__ = { markdown: markdownText, currentFile };
  }, [currentFile, markdownText]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/plugins')
      .then((res) => {
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        return res.json() as Promise<{ plugins?: PluginMetadata[] }>;
      })
      .then((data) => {
        if (!cancelled) setPlugins(data.plugins ?? []);
      })
      .catch(() => {
        if (!cancelled) setPluginState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearRenderTimer = useCallback(() => {
    if (debounceTimer.current != null) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  const doRender = useCallback(async (text: string, version: number) => {
    setStatus('rendering');
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: text }),
      });

      if (!res.ok) {
        throw new Error(`server returned ${res.status}`);
      }

      const data = (await res.json()) as {
        ok: boolean;
        html?: string;
        durationMs?: number;
        stderr?: string;
      };

      if (version !== renderVersion.current) return;

      if (data.ok && typeof data.html === 'string') {
        setPreviewHtml(data.html);
        setStatus('ready');
        setDurationMs(data.durationMs ?? null);
        setDiagnostics(null);
      } else {
        setPreviewHtml(errorDocument('Render failed'));
        setStatus('error');
        setDiagnostics({
          summary: 'Renderer Error',
          detail: data.stderr || 'Render failed',
        });
      }
    } catch (err) {
      if (version !== renderVersion.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setPreviewHtml(errorDocument(`Error: ${message}`));
      setStatus('error');
      setDiagnostics({
        summary: 'Renderer Error',
        detail: message,
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

  useEffect(() => {
    if (!isTempFile || window.__TEMP_BACKUP_FILE == null) return;
    const handle = window.setTimeout(() => {
      void fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: markdownText }),
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [isTempFile, markdownText]);

  const promptForSavePath = useCallback(
    (mode: 'save' | 'new'): Promise<string | null> => {
      return new Promise((resolve) => {
        saveAsResolveRef.current = resolve;
        setSaveAsDialogMode(mode);
        setSaveAsDialogOpen(true);
      });
    },
    [],
  );

  const handleSaveAsSubmit = useCallback((path: string) => {
    setSaveAsDialogOpen(false);
    saveAsResolveRef.current?.(path);
  }, []);

  const handleSaveAsCancel = useCallback(() => {
    setSaveAsDialogOpen(false);
    saveAsResolveRef.current?.(null);
  }, []);

  const persistMarkdown = useCallback(async (path: string, text: string) => {
    setSaveState('saving');
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: text, path }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        path?: string;
        workspaceRoot?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `server returned ${res.status}`);
      }

      const savedPath = data.path ?? path;
      setCurrentFile(savedPath);
      setWorkspaceRoot(data.workspaceRoot ?? workspaceRoot);
      setIsTempFile(false);
      setSaveState('saved');
      setSavedAt(new Date());
      setStatus('saved');
      return savedPath;
    } catch (err) {
      setSaveState('error');
      setStatus('error');
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Save failed',
        description: message,
        variant: 'destructive',
      });
      return null;
    }
  }, [workspaceRoot]);

  const ensureRealFile = useCallback(
    async (options: { promptForEmpty: boolean }) => {
      if (isTempFile || !currentFile) {
        if (!options.promptForEmpty && markdownText.length === 0 && saveState !== 'dirty') {
          return null;
        }
        const savePath = await promptForSavePath('save');
        if (savePath === null) return null;
        return persistMarkdown(savePath, markdownText);
      }

      if (saveState === 'dirty') {
        return persistMarkdown(currentFile, markdownText);
      }
      return currentFile;
    },
    [currentFile, isTempFile, markdownText, persistMarkdown, promptForSavePath, saveState],
  );

  const ensureBufferSafeToReplace = useCallback(async () => {
    if ((isTempFile || !currentFile) && markdownText.length === 0 && saveState !== 'dirty') {
      return true;
    }
    return (await ensureRealFile({ promptForEmpty: true })) != null;
  }, [currentFile, ensureRealFile, isTempFile, markdownText, saveState]);

  const saveCurrent = useCallback(async () => {
    renderImmediate(markdownText);
    await ensureRealFile({ promptForEmpty: true });
  }, [ensureRealFile, markdownText, renderImmediate]);

  // Always prompts for a new path, even if the document is already saved.
  const saveCurrentAs = useCallback(async () => {
    const savePath = await promptForSavePath('save');
    if (savePath === null) return;
    await persistMarkdown(savePath, markdownText);
  }, [markdownText, persistMarkdown, promptForSavePath]);

  const updateMarkdown = useCallback((value: string) => {
    setMarkdownText(value);
    setSaveState('dirty');
    setSavedAt(null);
  }, []);

  const insertTextAtCursor = useCallback(
    (text: string) => {
      const view = editorViewRef.current;
      if (!view) {
        updateMarkdown(`${markdownText}${text}`);
        return;
      }

      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      });
      view.focus();
    },
    [markdownText, updateMarkdown],
  );

  const insertCitation = useCallback(async () => {
    try {
      const res = await fetch('/api/zotero/cite');
      if (res.status === 204) return;

      const data = (await res.json().catch(() => ({}))) as {
        citation?: string;
        error?: string;
      };
      if (!res.ok || typeof data.citation !== 'string') {
        throw new Error(data.error ?? `server returned ${res.status}`);
      }

      insertTextAtCursor(data.citation);
      toast({
        title: 'Zotero citation',
        description: data.citation,
        variant: 'default',
      });
    } catch (err) {
      toast({
        title: 'Zotero citation',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [insertTextAtCursor]);

  // Shared upload path used by both the button handler and the paste event handler.
  const uploadImageAndInsert = useCallback(
    async (imageBlob: Blob, filePath: string) => {
      const imageType = imageBlob.type || 'image/png';
      const res = await fetch('/api/figures/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentPath: filePath,
          mimeType: imageType,
          contentBase64: await blobToBase64(imageBlob),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        markdown?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || typeof data.markdown !== 'string') {
        throw new Error(data.error ?? `server returned ${res.status}`);
      }
      insertTextAtCursor(`\n\n${data.markdown}\n\n`);
      toast({
        title: 'Clipboard image',
        description: data.markdown,
        variant: 'default',
      });
    },
    [insertTextAtCursor],
  );

  const insertClipboardFigure = useCallback(async () => {
    try {
      const filePath = await ensureRealFile({ promptForEmpty: true });
      if (filePath == null) return;
      if (!navigator.clipboard?.read) {
        throw new Error('clipboard image read is not available');
      }

      const items = await navigator.clipboard.read();
      let imageBlob: Blob | null = null;
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith('image/'));
        if (type) {
          imageBlob = await item.getType(type);
          break;
        }
      }
      if (!imageBlob) {
        throw new Error('clipboard does not contain an image');
      }

      await uploadImageAndInsert(imageBlob, filePath);
    } catch (err) {
      toast({
        title: 'Clipboard image',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [ensureRealFile, uploadImageAndInsert]);

  const runPluginAction = useCallback(
    async (pluginId: string) => {
      const filePath = await ensureRealFile({ promptForEmpty: true });
      if (filePath == null) return;

      const pluginMeta = plugins.find((p) => p.id === pluginId);
      setPluginState('running');
      setSaveState('saving');

      try {
        const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: markdownText, path: filePath }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          stdout?: string;
          stderr?: string;
          outputPath?: string;
        };

        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `server returned ${res.status}`);
        }

        setSaveState('saved');
        setSavedAt(new Date());
        setPluginState('complete');

        const handleOpen = async (e: React.MouseEvent) => {
          e.preventDefault();
          try {
            await fetch('/api/open-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: data.outputPath }),
            });
          } catch (err) {
            console.error('Failed to open file:', err);
          }
        };

        toast({
          title: pluginMeta?.name ?? pluginId,
          description: data.outputPath ? (
            <span>
              completed successfully. Output:{' '}
              <button
                onClick={handleOpen}
                className="underline text-[#8fb8ff] hover:text-[#b4d2ff] font-medium transition-colors focus-visible:outline-none"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {data.outputPath.split('/').at(-1)}
              </button>
            </span>
          ) : data.stderr ? (
            `stderr: ${data.stderr}`
          ) : (
            'completed successfully'
          ),
          variant: 'default',
        });
      } catch (err) {
        setSaveState('error');
        setPluginState('error');
        setStatus('error');

        const message = err instanceof Error ? err.message : String(err);
        toast({
          title: pluginMeta?.name ?? pluginId,
          description: message,
          variant: 'destructive',
        });
      }
    },
    [ensureRealFile, markdownText, plugins],
  );

  const createNewFile = useCallback(async () => {
    if (!(await ensureBufferSafeToReplace())) return;

    const savePath = await promptForSavePath('new');
    if (savePath === null) return; // user cancelled

    setSaveState('saving');

    try {
      // Create file at the specified workspace-relative path
      const res = await fetch('/api/files/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: savePath }),
      });
      const data = (await res.json().catch(() => ({}))) as OpenFileResult & {
        ok?: boolean;
        workspaceRoot?: string;
        error?: string;
      };

      if (!res.ok || !data.ok || typeof data.absolutePath !== 'string') {
        throw new Error(data.error ?? `server returned ${res.status}`);
      }

      setMarkdownText(data.content);
      setCurrentFile(data.absolutePath);
      setWorkspaceRoot(data.workspaceRoot ?? workspaceRoot);
      setIsTempFile(false);
      setSaveState('dirty');
      setSavedAt(null);
      setStatus('ready');
    } catch (err) {
      setSaveState('error');
      setStatus('error');
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Create file failed',
        description: message,
        variant: 'destructive',
      });
    }
  }, [ensureBufferSafeToReplace, promptForSavePath, workspaceRoot]);

  const openFile = useCallback(async (result: OpenFileResult) => {
    if (!(await ensureBufferSafeToReplace())) return false;
    setMarkdownText(result.content);
    setCurrentFile(result.absolutePath);
    setIsTempFile(false);
    setSaveState('idle');
    setSavedAt(null);
    return true;
  }, [ensureBufferSafeToReplace]);

  const openQuickOpen = useCallback(() => {
    setQuickOpenOpen(true);
    requestAnimationFrame(() => quickOpenInputRef.current?.focus());
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        openQuickOpen();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault();
        void saveCurrentAs();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'c'
      ) {
        event.preventDefault();
        void insertCitation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [insertCitation, openQuickOpen, saveCurrentAs]);

  // Wayland-compatible paste handler: navigator.clipboard.read() is broken on
  // Wayland for binary image types. The paste DOM event's clipboardData.items is
  // the reliable path on all platforms including Wayland.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      let imageFile: File | null = null;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          imageFile = item.getAsFile();
          break;
        }
      }
      if (!imageFile) return;
      // There is an image on the clipboard: take ownership and upload it.
      event.preventDefault();
      event.stopPropagation();
      const blob = imageFile;
      void ensureRealFile({ promptForEmpty: true }).then((filePath) => {
        if (filePath == null) return;
        return uploadImageAndInsert(blob, filePath);
      }).catch((err: unknown) => {
        toast({
          title: 'Clipboard image',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      });
    };

    document.addEventListener('paste', handlePaste, { capture: true });
    return () => document.removeEventListener('paste', handlePaste, { capture: true });
  }, [ensureRealFile, uploadImageAndInsert]);

  const resetSplit = useCallback(() => {
    groupRef.current?.setLayout(RESET_LAYOUT);
  }, [groupRef]);

  return (
    <Tooltip.Provider delayDuration={250}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#15161a] text-[#e6e8eb]">
        <TopMenuBar
          explorerOpen={explorerOpen}
          onInsertClipboardFigure={insertClipboardFigure}
          onNewFile={createNewFile}
          onInsertCitation={insertCitation}
          onOpenExplorer={() => setExplorerOpen(true)}
          onOpenQuickOpen={openQuickOpen}
          onRefresh={() => renderImmediate(markdownText)}
          onRunPlugin={runPluginAction}
          onResetSplit={resetSplit}
          onSave={saveCurrent}
          onToggleExplorer={() => setExplorerOpen((open) => !open)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenFilterSettings={() => setFilterSettingsOpen(true)}
          onOpenDiagram={() => setDiagramOpen(true)}
          plugins={plugins}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AnimatePresence initial={false}>
            {explorerOpen ? (
              <ExplorerDrawer
                currentFile={currentFile}
                onOpenFile={openFile}
                root={workspaceRoot}
              />
            ) : null}
          </AnimatePresence>
          <Group
            id="editor-preview-group"
            className="min-w-0 flex-1"
            defaultLayout={RESET_LAYOUT}
            groupRef={groupRef}
            orientation="horizontal"
          >
            <Panel id="editor-pane-panel" minSize="24%" defaultSize="56%">
              <EditorPane
                fileName={currentFile ?? ''}
                markdown={markdownText}
                onChange={updateMarkdown}
                onCreateEditor={(view) => {
                  editorViewRef.current = view;
                }}
                onSave={saveCurrent}
              />
            </Panel>
            <Separator
              id="editor-preview-separator"
              className="group flex w-2 cursor-col-resize items-center justify-center bg-[#252831] outline-none transition-colors hover:bg-[#334052] focus-visible:bg-[#3f5f82]"
            >
              <GripVertical className="h-4 w-4 text-[#8791a3] group-hover:text-white" />
            </Separator>
            <Panel id="preview-pane-panel" minSize="24%" defaultSize="44%">
              <PreviewPane html={previewHtml} />
            </Panel>
          </Group>
        </div>
        {diagnostics ? (
          <div
            data-testid="diagnostics-panel"
            className="flex flex-col border-t border-[#401614] bg-[#2d1413] px-4 py-3 text-sm text-[#ff9b8f] shrink-0"
          >
            <div className="flex items-center justify-between mb-1">
              <span data-testid="diagnostics-title" className="font-semibold flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-[#ff9b8f]"></span>
                Renderer Error
              </span>
              <button
                onClick={() => setDiagnostics(null)}
                className="text-[#ffa89e] hover:text-white text-xs font-medium transition-colors focus-visible:outline-none"
              >
                Dismiss
              </button>
            </div>
            <pre
              data-testid="diagnostics-detail"
              className="mt-1 max-h-36 overflow-auto font-mono text-xs whitespace-pre-wrap leading-relaxed text-[#ffa89e] bg-[#220d0c] p-2.5 rounded border border-[#541e1b]"
            >
              {diagnostics.detail}
            </pre>
          </div>
        ) : null}
        <StatusCluster
          currentFile={currentFile}
          durationMs={durationMs}
          lineCountValue={lineCount(markdownText)}
          pluginState={pluginState}
          savedAt={savedAt}
          saveState={saveState}
          status={status}
        />
        <FileSelectorDialog
          mode={saveAsDialogMode}
          open={saveAsDialogOpen}
          workspaceRoot={workspaceRoot}
          onCancel={handleSaveAsCancel}
          onSubmit={handleSaveAsSubmit}
        />
        <QuickOpenDialog
          inputRef={quickOpenInputRef}
          onCancel={() => setQuickOpenOpen(false)}
          onOpenFile={openFile}
          open={quickOpenOpen}
          workspaceRoot={workspaceRoot}
        />
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSave={() => renderImmediate(markdownText)}
        />
        <FilterSettingsModal
          open={filterSettingsOpen}
          onClose={() => setFilterSettingsOpen(false)}
          onSave={() => renderImmediate(markdownText)}
        />
        <DiagramModal
          open={diagramOpen}
          onClose={() => setDiagramOpen(false)}
          ensureRealFile={() => ensureRealFile({ promptForEmpty: true })}
          insertTextAtCursor={insertTextAtCursor}
        />
        <Toaster />
      </div>
    </Tooltip.Provider>
  );
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function errorDocument(message: string) {
  return `<html><body style="color:#b42318;padding:2rem;font-family:system-ui,sans-serif">${escapeHtml(
    message,
  )}</body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
