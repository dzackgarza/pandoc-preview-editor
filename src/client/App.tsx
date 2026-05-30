import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { GripVertical, FolderOpen, Image as ImageIcon, Settings } from 'lucide-react';
import { EditorView } from '@codemirror/view';
import * as Tooltip from '@radix-ui/react-tooltip';
import { invoke } from '@tauri-apps/api/core';

import { cn, lineCount } from './lib/utils.js';
import { useToast, toast } from './lib/toast.js';

// Import sub-components
import { TopMenuBar } from './components/TopMenuBar.jsx';
import { ExplorerDrawer } from './components/ExplorerDrawer.jsx';
import { EditorPane } from './components/EditorPane.jsx';
import { PreviewPane } from './components/PreviewPane.jsx';
import { StatusCluster } from './components/StatusCluster.jsx';
import { FileSelectorDialog } from './components/FileSelectorDialog.jsx';
import { Toaster } from './components/Toaster.jsx';
import { SettingsDialog } from './components/SettingsDialog.jsx';
import { DiagramModal } from './components/DiagramModal.jsx';
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog.jsx';

export type RenderStatus = 'idle' | 'rendering' | 'error';
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

type InitialState = {
  content: string;
  file: string | null;
  tempBackupFile: string | null;
  workspaceRoot: string;
  isTempFile: boolean;
  recoveredFromBackup: boolean;
};

const DEBOUNCE_MS = 400;
const RESET_LAYOUT = {
  'editor-pane-panel': 56,
  'preview-pane-panel': 44,
};

export function App() {
  const [markdownText, setMarkdownText] = useState('');
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [isTempFile, setIsTempFile] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [status, setStatus] = useState<RenderStatus>('idle');
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<{
    summary: string;
    detail: string;
  } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pluginState, setPluginState] = useState<PluginState>('idle');
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [saveAsDialogMode, setSaveAsDialogMode] = useState<'save' | 'new'>('save');
  const [saveAsDialogTitleOverride, setSaveAsDialogTitleOverride] = useState<
    string | undefined
  >(undefined);
  const [saveAsDialogDescription, setSaveAsDialogDescription] = useState<
    string | undefined
  >(undefined);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'figures'>('explorer');
  const renderVersion = useRef(0);
  const debounceTimer = useRef<number | null>(null);
  const groupRef = useGroupRef();
  const editorViewRef = useRef<EditorView | null>(null);
  const saveAsInputRef = useRef<HTMLInputElement>(null);
  const saveAsResolveRef = useRef<((path: string | null) => void) | null>(null);
  const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);
  const unsavedChangesResolveRef = useRef<
    ((choice: 'save' | 'discard' | 'cancel') => void) | null
  >(null);

  useEffect(() => {
    invoke<InitialState>('get_initial_state')
      .then((data) => {
        setMarkdownText(data.content);
        setCurrentFile(data.file ?? null);
        setIsTempFile(data.isTempFile);
        setWorkspaceRoot(data.workspaceRoot);
        if (data.recoveredFromBackup) {
          setSaveState('dirty');
          toast({
            title: 'Unsaved Changes Recovered',
            description: 'Your unsaved changes were recovered from backup.',
            variant: 'default',
          });
        }
      })
      .catch((err) => {
        throw new Error(
          `Failed to load initial state: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }, []);

  useEffect(() => {
    window.__PANDOC_PREVIEW_STATE__ = { markdown: markdownText, currentFile };
  }, [currentFile, markdownText]);

  useEffect(() => {
    let cancelled = false;
    invoke<{ plugins: PluginMetadata[] }>('list_plugins')
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
      const data = await invoke<{
        ok: boolean;
        html: string;
        durationMs: number;
        stderr: string;
      }>('render', { markdown: text });

      if (version !== renderVersion.current) return;

      if (data.ok && typeof data.html === 'string') {
        setPreviewHtml(data.html);
        setStatus('idle');
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
    if (saveState !== 'dirty') return;
    const handle = window.setTimeout(() => {
      void invoke('backup', {
        markdown: markdownText,
        path: currentFile,
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [saveState, markdownText, currentFile]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveState === 'dirty') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveState]);

  const promptForSavePath = useCallback(
    (
      mode: 'save' | 'new',
      titleOverride?: string,
      description?: string,
    ): Promise<string | null> => {
      return new Promise((resolve) => {
        saveAsResolveRef.current = resolve;
        setSaveAsDialogMode(mode);
        setSaveAsDialogTitleOverride(titleOverride);
        setSaveAsDialogDescription(description);
        setSaveAsDialogOpen(true);
      });
    },
    [],
  );

  const handleSaveAsSubmit = useCallback((path: string) => {
    setSaveAsDialogOpen(false);
    setSaveAsDialogTitleOverride(undefined);
    setSaveAsDialogDescription(undefined);
    saveAsResolveRef.current?.(path);
  }, []);

  const handleSaveAsCancel = useCallback(() => {
    setSaveAsDialogOpen(false);
    setSaveAsDialogTitleOverride(undefined);
    setSaveAsDialogDescription(undefined);
    saveAsResolveRef.current?.(null);
  }, []);

  const promptForUnsavedChanges = useCallback((): Promise<
    'save' | 'discard' | 'cancel'
  > => {
    return new Promise((resolve) => {
      unsavedChangesResolveRef.current = resolve;
      setUnsavedChangesDialogOpen(true);
    });
  }, []);

  const handleUnsavedChangesSave = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    unsavedChangesResolveRef.current?.('save');
  }, []);

  const handleUnsavedChangesDiscard = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    unsavedChangesResolveRef.current?.('discard');
  }, []);

  const handleUnsavedChangesCancel = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    unsavedChangesResolveRef.current?.('cancel');
  }, []);

  const persistMarkdown = useCallback(
    async (path: string, text: string) => {
      setSaveState('saving');
      try {
        const data = await invoke<{
          ok: boolean;
          path: string;
          workspaceRoot: string;
        }>('save', { markdown: text, path });

        if (!data.ok) {
          throw new Error('save failed');
        }

        const savedPath = data.path ?? path;
        setCurrentFile(savedPath);
        setWorkspaceRoot(data.workspaceRoot ?? workspaceRoot);
        setIsTempFile(false);
        setSaveState('saved');
        setSavedAt(new Date());
        return savedPath;
      } catch (err) {
        setSaveState('error');
        const message = err instanceof Error ? err.message : String(err);
        toast({
          title: 'Save failed',
          description: message,
          variant: 'destructive',
        });
        return null;
      }
    },
    [workspaceRoot],
  );

  const ensureRealFile = useCallback(
    async (options: {
      promptForEmpty: boolean;
      title?: string;
      description?: string;
    }) => {
      if (isTempFile || !currentFile) {
        if (
          !options.promptForEmpty &&
          markdownText.length === 0 &&
          saveState !== 'dirty'
        ) {
          return null;
        }
        const savePath = await promptForSavePath(
          'save',
          options.title,
          options.description,
        );
        if (savePath === null) return null;
        return persistMarkdown(savePath, markdownText);
      }

      if (saveState === 'dirty') {
        return persistMarkdown(currentFile, markdownText);
      }
      return currentFile;
    },
    [
      currentFile,
      isTempFile,
      markdownText,
      persistMarkdown,
      promptForSavePath,
      saveState,
    ],
  );

  const ensureBufferSafeToReplace = useCallback(async () => {
    if (
      (isTempFile || !currentFile) &&
      markdownText.length === 0 &&
      saveState !== 'dirty'
    ) {
      return true;
    }
    if (saveState !== 'dirty') {
      return true;
    }
    const choice = await promptForUnsavedChanges();
    if (choice === 'cancel') {
      return false;
    }
    if (choice === 'save') {
      return (await ensureRealFile({ promptForEmpty: true })) != null;
    }
    return true; // discard
  }, [
    currentFile,
    ensureRealFile,
    isTempFile,
    markdownText,
    promptForUnsavedChanges,
    saveState,
  ]);

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
      const data = await invoke<{ citation?: string; empty?: boolean }>('zotero_cite');
      if (data.empty) return;

      if (typeof data.citation !== 'string') {
        throw new Error('no citation returned');
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
      const data = await invoke<{
        ok: boolean;
        markdown: string;
        path: string;
        relativePath: string;
      }>('save_figure_asset', {
        documentPath: filePath,
        mimeType: imageType,
        contentBase64: await blobToBase64(imageBlob),
      });

      if (!data.ok || typeof data.markdown !== 'string') {
        throw new Error('Failed to save figure asset');
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
      const filePath = await ensureRealFile({
        promptForEmpty: true,
        title: 'Save Markdown Document',
        description:
          'Save your active document to disk first. Adding figure/diagram assets requires a saved file context to resolve relative asset paths correctly.',
      });
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
      const pluginMeta = plugins.find((p) => p.id === pluginId);
      const pluginName = pluginMeta?.name ?? pluginId;
      const filePath = await ensureRealFile({
        promptForEmpty: true,
        title: 'Save Original Markdown Document',
        description: `Please choose a location to save your original Markdown document first. The plugin "${pluginName}" requires a saved file context on disk to run.`,
      });
      if (filePath == null) return;
      setPluginState('running');
      setSaveState('saving');

      try {
        const data = await invoke<{
          ok: boolean;
          stdout: string;
          stderr: string;
          exitCode: number | null;
          outputPath?: string;
        }>('run_plugin', {
          id: pluginId,
          markdown: markdownText,
          path: filePath,
        });

        if (!data.ok) {
          throw new Error(data.stderr || 'plugin execution failed');
        }

        setSaveState('saved');
        setSavedAt(new Date());
        setPluginState('idle');

        const handleOpen = async (e: React.MouseEvent) => {
          e.preventDefault();
          try {
            await invoke('open_file_external', { path: data.outputPath });
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
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
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
        setPluginState('idle');

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
      const data = await invoke<{
        ok: boolean;
        path: string;
        absolutePath: string;
        content: string;
        workspaceRoot: string;
      }>('new_file', { path: savePath });

      if (!data.ok || typeof data.absolutePath !== 'string') {
        throw new Error('Failed to create file');
      }

      setMarkdownText(data.content);
      setCurrentFile(data.absolutePath);
      setWorkspaceRoot(data.workspaceRoot ?? workspaceRoot);
      setIsTempFile(false);
      setSaveState('dirty');
      setSavedAt(null);
    } catch (err) {
      setSaveState('error');
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Create file failed',
        description: message,
        variant: 'destructive',
      });
    }
  }, [ensureBufferSafeToReplace, promptForSavePath, workspaceRoot]);

  const openFile = useCallback(
    async (result: OpenFileResult) => {
      if (!(await ensureBufferSafeToReplace())) return false;
      setMarkdownText(result.content);
      setCurrentFile(result.absolutePath);
      setIsTempFile(false);
      setSaveState('idle');
      setSavedAt(null);
      return true;
    },
    [ensureBufferSafeToReplace],
  );

  const handleQuickOpen = useCallback(async () => {
    try {
      const data = await invoke<{
        ok: boolean;
        cancelled?: boolean;
        path: string;
        absolutePath: string;
        content: string;
        error?: string;
      }>('quick_open_spawn');
      if (data.ok) {
        await openFile({
          path: data.path,
          absolutePath: data.absolutePath,
          content: data.content,
        });
      } else if (data.error) {
        toast({
          title: 'Quick Open Error',
          description: data.error,
          variant: 'destructive',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Quick Open Failed',
        description: msg,
        variant: 'destructive',
      });
    }
  }, [openFile]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        void handleQuickOpen();
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
    return () =>
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleQuickOpen, insertCitation, saveCurrentAs]);

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
      void ensureRealFile({
        promptForEmpty: true,
        title: 'Save Markdown Document',
        description:
          'Save your active document to disk first. Adding figure/diagram assets requires a saved file context to resolve relative asset paths correctly.',
      })
        .then((filePath) => {
          if (filePath == null) return;
          return uploadImageAndInsert(blob, filePath);
        })
        .catch((err: unknown) => {
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
          onOpenQuickOpen={handleQuickOpen}
          onRefresh={() => renderImmediate(markdownText)}
          onRunPlugin={runPluginAction}
          onResetSplit={resetSplit}
          onSave={saveCurrent}
          onToggleExplorer={() => setExplorerOpen((open) => !open)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenDiagram={() => setDiagramOpen(true)}
          plugins={plugins}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Vertical Activity Bar */}
          <div className="w-12 border-r border-[#2b2f38] bg-[#14171f] flex flex-col items-center py-4 gap-4 shrink-0 justify-between select-none">
            <div className="flex flex-col gap-4 w-full items-center">
              {/* File Explorer tab trigger */}
              <button
                aria-label="File Explorer"
                onClick={() => {
                  if (explorerOpen && sidebarTab === 'explorer') {
                    setExplorerOpen(false);
                  } else {
                    setExplorerOpen(true);
                    setSidebarTab('explorer');
                  }
                }}
                className={cn(
                  'h-8 w-8 rounded-lg flex items-center justify-center transition-all cursor-pointer',
                  explorerOpen && sidebarTab === 'explorer'
                    ? 'bg-[#303541] text-white'
                    : 'text-[#788190] hover:text-[#e6e8eb]',
                )}
              >
                <FolderOpen className="h-5 w-5" />
              </button>

              {/* Figures Library tab trigger */}
              <button
                aria-label="Figures Library"
                onClick={() => {
                  if (explorerOpen && sidebarTab === 'figures') {
                    setExplorerOpen(false);
                  } else {
                    setExplorerOpen(true);
                    setSidebarTab('figures');
                  }
                }}
                className={cn(
                  'h-8 w-8 rounded-lg flex items-center justify-center transition-all cursor-pointer',
                  explorerOpen && sidebarTab === 'figures'
                    ? 'bg-[#303541] text-white'
                    : 'text-[#788190] hover:text-[#e6e8eb]',
                )}
              >
                <ImageIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="w-full flex justify-center">
              {/* Preferences Settings dialog trigger */}
              <button
                aria-label="Preferences"
                onClick={() => setSettingsOpen(true)}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-[#788190] hover:text-[#e6e8eb] cursor-pointer transition-all"
              >
                <Settings className="h-5 w-5" />
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {explorerOpen ? (
              <ExplorerDrawer
                currentFile={currentFile}
                onOpenFile={openFile}
                root={workspaceRoot}
                view={sidebarTab}
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
              <span
                data-testid="diagnostics-title"
                className="font-semibold flex items-center gap-1.5"
              >
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
          titleOverride={saveAsDialogTitleOverride}
          description={saveAsDialogDescription}
          onCancel={handleSaveAsCancel}
          onSubmit={handleSaveAsSubmit}
        />
        <UnsavedChangesDialog
          open={unsavedChangesDialogOpen}
          onCancel={handleUnsavedChangesCancel}
          onDiscard={handleUnsavedChangesDiscard}
          onSave={handleUnsavedChangesSave}
        />
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSave={() => renderImmediate(markdownText)}
        />
        <DiagramModal
          open={diagramOpen}
          onClose={() => setDiagramOpen(false)}
          ensureRealFile={() =>
            ensureRealFile({
              promptForEmpty: true,
              title: 'Save Markdown Document',
              description:
                'Save your active document to disk first. Adding figure/diagram assets requires a saved file context to resolve relative asset paths correctly.',
            })
          }
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
