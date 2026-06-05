import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { GripVertical, FolderOpen, Image as ImageIcon, Settings } from 'lucide-react';
import { EditorView } from '@codemirror/view';
import * as Tooltip from '@radix-ui/react-tooltip';
import { invoke } from '@tauri-apps/api/core';

import { cn, lineCount, blobToBase64 } from './lib/utils.js';
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

// Import hooks
import { useFileManager } from './hooks/useFileManager.js';
import { useRenderer } from './hooks/useRenderer.js';
import { usePlugins } from './hooks/usePlugins.js';

declare global {
  interface Window {
    __PW_ACTIVE__: boolean;
    __PANDOC_PREVIEW_BACKUP_COMPLETED__?: number;
  }
}

const RESET_LAYOUT = {
  'editor-pane-panel': 56,
  'preview-pane-panel': 44,
};

export function App() {
  const {
    markdownText,
    currentFile,
    isTempFile,
    workspaceRoot,
    saveState,
    savedAt,
    saveAsDialogOpen,
    saveAsDialogMode,
    saveAsDialogTitleOverride,
    saveAsDialogDescription,
    unsavedChangesDialogOpen,
    setMarkdownText,
    setCurrentFile,
    setIsTempFile,
    setWorkspaceRoot,
    setSaveState,
    setSavedAt,
    updateMarkdown,
    saveCurrent,
    saveCurrentAs,
    createNewFile,
    openFile,
    handleQuickOpen,
    ensureRealFile,
    handleSaveAsSubmit,
    handleSaveAsCancel,
    handleUnsavedChangesSave,
    handleUnsavedChangesDiscard,
    handleUnsavedChangesCancel,
  } = useFileManager();

  const {
    previewHtml,
    status,
    durationMs,
    diagnostics,
    setDiagnostics,
    renderImmediate,
    scheduleRender,
  } = useRenderer(markdownText, currentFile, null);

  const {
    pluginState,
    plugins,
    runPluginAction,
  } = usePlugins(markdownText, ensureRealFile, setSaveState, setSavedAt);

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'figures'>('explorer');
  const [lastBackupSaved, setLastBackupSaved] = useState<Date | null>(null);

  const groupRef = useGroupRef();
  const editorViewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    invoke<any>('get_initial_state')
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
        console.error('Failed to load initial state:', err);
      });
  }, [setMarkdownText, setCurrentFile, setIsTempFile, setWorkspaceRoot, setSaveState]);

  useEffect(() => {
    if (saveState !== 'dirty' || !currentFile) return;
    const handle = window.setTimeout(() => {
      void invoke('backup', {
        markdown: markdownText,
        path: currentFile,
      }).then(() => {
        setLastBackupSaved(new Date());
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

  const uploadImageAndInsert = useCallback(
    async (imageBlob: Blob, filePath: string) => {
      const imageType = imageBlob.type || 'image/png';
      const data = await invoke<{
        ok: boolean;
        markdown: string;
        path: string;
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

  const handleSaveAction = useCallback(async () => {
    renderImmediate(markdownText);
    await saveCurrent();
  }, [markdownText, renderImmediate, saveCurrent]);

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
          onSave={handleSaveAction}
          onToggleExplorer={() => setExplorerOpen((open) => !open)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenDiagram={() => setDiagramOpen(true)}
          plugins={plugins}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="w-12 border-r border-[#2b2f38] bg-[#14171f] flex flex-col items-center py-4 gap-4 shrink-0 justify-between select-none">
            <div className="flex flex-col gap-4 w-full items-center">
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
                onSave={handleSaveAction}
              />
            </Panel>
            <Separator
              id="editor-preview-separator"
              className="group flex w-2 cursor-col-resize items-center justify-center bg-[#252831] outline-none transition-colors hover:bg-[#334052] focus-visible:bg-[#3f5f82]"
            >
              <GripVertical className="h-4 w-4 text-[#8791a3] group-hover:text-white" />
            </Separator>
            <Panel id="preview-pane-panel" minSize="24%" defaultSize="44%">
              <PreviewPane html={previewHtml} error={status === 'error' ? diagnostics?.detail : null} />
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
          backupSaved={lastBackupSaved}
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
