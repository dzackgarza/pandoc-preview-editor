import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, keymap } from '@codemirror/view';
import * as Menubar from '@radix-ui/react-menubar';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  PanelLeftOpen,
  Plug,
  RefreshCcw,
  Save,
  Search,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { basename, cn, lineCount } from './lib/utils.js';
import { useToast, toast } from './lib/toast.js';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './lib/toast-ui.jsx';

type RenderStatus = 'ready' | 'rendering' | 'error' | 'saved';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
type PluginState = 'idle' | 'running' | 'complete' | 'error';

type FileEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
};

type OpenFileResult = {
  path: string;
  absolutePath: string;
  content: string;
};

type QuickOpenEntry = {
  path: string;
  absolutePath: string;
  name: string;
  dir: string;
  recent: boolean;
};

type PluginMetadata = {
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
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pluginState, setPluginState] = useState<PluginState>('idle');
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [saveAsDialogMode, setSaveAsDialogMode] = useState<'save' | 'new'>('save');
  const [workspaceRoot, setWorkspaceRoot] = useState(window.__WORKSPACE_ROOT ?? '');
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
      };

      if (version !== renderVersion.current) return;

      if (data.ok && typeof data.html === 'string') {
        setPreviewHtml(data.html);
        setStatus('ready');
        setDurationMs(data.durationMs ?? null);
      } else {
        setPreviewHtml(errorDocument('Render failed'));
        setStatus('error');
      }
    } catch (err) {
      if (version !== renderVersion.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setPreviewHtml(errorDocument(`Error: ${message}`));
      setStatus('error');
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
        // Focus input on next render
        requestAnimationFrame(() => saveAsInputRef.current?.focus());
      });
    },
    [],
  );

  const handleSaveAsSubmit = useCallback((relativePath: string) => {
    setSaveAsDialogOpen(false);
    saveAsResolveRef.current?.(relativePath);
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

  const insertClipboardFigure = useCallback(async () => {
    try {
      const filePath = await ensureRealFile({ promptForEmpty: true });
      if (filePath == null) return;
      if (!navigator.clipboard?.read) {
        throw new Error('clipboard image read is not available');
      }

      const items = await navigator.clipboard.read();
      let imageBlob: Blob | null = null;
      let imageType = '';
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith('image/'));
        if (type) {
          imageBlob = await item.getType(type);
          imageType = imageBlob.type || type;
          break;
        }
      }
      if (!imageBlob) {
        throw new Error('clipboard does not contain an image');
      }

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
    } catch (err) {
      toast({
        title: 'Clipboard image',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [ensureRealFile, insertTextAtCursor]);

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

        toast({
          title: pluginMeta?.name ?? pluginId,
          description: data.stderr
            ? `stderr: ${data.stderr}`
            : 'completed successfully',
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
        event.key.toLowerCase() === 'c'
      ) {
        event.preventDefault();
        void insertCitation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [insertCitation, openQuickOpen]);

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
                fileName={basename(currentFile)}
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
        <StatusCluster
          currentFile={currentFile}
          durationMs={durationMs}
          lineCountValue={lineCount(markdownText)}
          pluginState={pluginState}
          savedAt={savedAt}
          saveState={saveState}
          status={status}
        />
        <SaveAsDialog
          inputRef={saveAsInputRef}
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
        <Toaster />
      </div>
    </Tooltip.Provider>
  );
}

function TopMenuBar({
  explorerOpen,
  onInsertClipboardFigure,
  onInsertCitation,
  onNewFile,
  onOpenExplorer,
  onOpenQuickOpen,
  onRefresh,
  onRunPlugin,
  onResetSplit,
  onSave,
  onToggleExplorer,
  plugins,
}: {
  explorerOpen: boolean;
  onInsertClipboardFigure: () => void;
  onInsertCitation: () => void;
  onNewFile: () => void;
  onOpenExplorer: () => void;
  onOpenQuickOpen: () => void;
  onRefresh: () => void;
  onRunPlugin: (pluginId: string) => void;
  onResetSplit: () => void;
  onSave: () => void;
  onToggleExplorer: () => void;
  plugins: PluginMetadata[];
}) {
  const pluginsByCategory = useMemo(() => groupPluginsByCategory(plugins), [plugins]);

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-[#2b2f38] bg-[#20232b] px-2">
      <Menubar.Root className="flex items-center gap-1 text-sm text-[#d6d9df]">
        <Menubar.Menu>
          <Menubar.Trigger className="rounded px-3 py-1.5 outline-none hover:bg-[#303541] focus:bg-[#303541] data-[state=open]:bg-[#303541]">
            File
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className="z-50 min-w-40 rounded border border-[#343946] bg-[#22262f] p-1 text-sm text-[#e7eaf0] shadow-xl">
              <MenuItem onSelect={onNewFile}>
                <FilePlus className="h-4 w-4" />
                New
              </MenuItem>
              <MenuItem onSelect={onOpenExplorer}>
                <FolderOpen className="h-4 w-4" />
                Open
              </MenuItem>
              <MenuItem onSelect={onOpenQuickOpen}>
                <Search className="h-4 w-4" />
                Quick Open
              </MenuItem>
              <Menubar.Separator className="my-1 h-px bg-[#343946]" />
              <MenuItem onSelect={onSave}>
                <Save className="h-4 w-4" />
                Save
              </MenuItem>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
        <Menubar.Menu>
          <Menubar.Trigger className="rounded px-3 py-1.5 outline-none hover:bg-[#303541] focus:bg-[#303541] data-[state=open]:bg-[#303541]">
            View
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className="z-50 min-w-48 rounded border border-[#343946] bg-[#22262f] p-1 text-sm text-[#e7eaf0] shadow-xl">
              <MenuItem onSelect={onToggleExplorer}>
                <PanelLeftOpen className="h-4 w-4" />
                {explorerOpen ? 'Hide Explorer' : 'Show Explorer'}
              </MenuItem>
              <Menubar.Separator className="my-1 h-px bg-[#343946]" />
              <MenuItem onSelect={onResetSplit}>
                <RefreshCcw className="h-4 w-4" />
                Reset Split
              </MenuItem>
              <MenuItem onSelect={onRefresh}>
                <RefreshCcw className="h-4 w-4" />
                Refresh Preview
              </MenuItem>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
        <Menubar.Menu>
          <Menubar.Trigger className="rounded px-3 py-1.5 outline-none hover:bg-[#303541] focus:bg-[#303541] data-[state=open]:bg-[#303541]">
            Insert
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className="z-50 min-w-44 rounded border border-[#343946] bg-[#22262f] p-1 text-sm text-[#e7eaf0] shadow-xl">
              <MenuItem onSelect={onInsertCitation}>
                <BookOpen className="h-4 w-4" />
                Citation
              </MenuItem>
              <MenuItem onSelect={onInsertClipboardFigure}>
                <ImageIcon className="h-4 w-4" />
                Clipboard Image
              </MenuItem>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
        <Menubar.Menu>
          <Menubar.Trigger className="rounded px-3 py-1.5 outline-none hover:bg-[#303541] focus:bg-[#303541] data-[state=open]:bg-[#303541]">
            Plugin
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content className="z-50 min-w-52 rounded border border-[#343946] bg-[#22262f] p-1 text-sm text-[#e7eaf0] shadow-xl">
              {pluginsByCategory.length === 0 ? (
                <Menubar.Item
                  className="flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-[#788190] outline-none"
                  disabled
                >
                  <Plug className="h-4 w-4" />
                  No plugins
                </Menubar.Item>
              ) : (
                pluginsByCategory.map(({ category, items }) => (
                  <Menubar.Sub key={category}>
                    <Menubar.SubTrigger className="flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-[#344154] focus:bg-[#344154] data-[state=open]:bg-[#344154]">
                      <Plug className="h-4 w-4" />
                      {category}
                      <ChevronRight className="ml-auto h-4 w-4" />
                    </Menubar.SubTrigger>
                    <Menubar.Portal>
                      <Menubar.SubContent className="z-50 min-w-56 rounded border border-[#343946] bg-[#22262f] p-1 text-sm text-[#e7eaf0] shadow-xl">
                        {items.map((plugin) => (
                          <MenuItem
                            key={plugin.id}
                            onSelect={() => onRunPlugin(plugin.id)}
                          >
                            <FileText className="h-4 w-4" />
                            {plugin.name}
                          </MenuItem>
                        ))}
                      </Menubar.SubContent>
                    </Menubar.Portal>
                  </Menubar.Sub>
                ))
              )}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      </Menubar.Root>
      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Toggle Explorer" onClick={onToggleExplorer}>
          <PanelLeftOpen className="h-4 w-4" />
        </IconButton>
        <IconButton label="Save" onClick={onSave}>
          <Save className="h-4 w-4" />
        </IconButton>
        <IconButton label="Insert Citation" onClick={onInsertCitation}>
          <BookOpen className="h-4 w-4" />
        </IconButton>
        <IconButton label="Insert Figure from Clipboard" onClick={onInsertClipboardFigure}>
          <ImageIcon className="h-4 w-4" />
        </IconButton>
        <IconButton label="Refresh Preview" onClick={onRefresh}>
          <RefreshCcw className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function MenuItem({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Menubar.Item
      className="flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 outline-none hover:bg-[#344154] focus:bg-[#344154]"
      onSelect={onSelect}
    >
      {children}
    </Menubar.Item>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          aria-label={label}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[#b9c0cc] hover:bg-[#303541] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6aa8ff]"
          type="button"
          onClick={onClick}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-50 rounded bg-[#111318] px-2 py-1 text-xs text-white shadow-lg"
          sideOffset={6}
        >
          {label}
          <Tooltip.Arrow className="fill-[#111318]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function EditorPane({
  fileName,
  markdown,
  onChange,
  onCreateEditor,
  onSave,
}: {
  fileName: string;
  markdown: string;
  onChange: (value: string) => void;
  onCreateEditor: (view: EditorView) => void;
  onSave: () => void;
}) {
  const extensions = useMemo(
    () => [
      markdownExtension(),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            onSave();
            return true;
          },
        },
      ]),
    ],
    [onSave],
  );

  return (
    <section
      id="editor"
      className="flex h-full min-w-0 flex-col border-r border-[#2b2f38] bg-[#17181c]"
      data-testid="editor"
    >
      <PaneHeader title="Editor" detail={fileName} />
      <div className="min-h-0 flex-1 overflow-auto" data-testid="editor-frame">
        <CodeMirror
          basicSetup
          extensions={extensions}
          height="100%"
          theme="dark"
          value={markdown}
          onChange={onChange}
          onCreateEditor={onCreateEditor}
        />
      </div>
    </section>
  );
}

function PreviewPane({ html }: { html: string }) {
  return (
    <section
      id="preview-pane"
      className="flex h-full min-w-0 flex-col bg-[#f7f7f4]"
      data-testid="preview-pane"
    >
      <PaneHeader title="Preview" detail="Pandoc HTML" light />
      <div className="min-h-0 flex-1 p-5">
        <iframe
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

function PaneHeader({
  detail,
  light = false,
  title,
}: {
  detail: string;
  light?: boolean;
  title: string;
}) {
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center justify-between border-b px-3 text-xs uppercase',
        light
          ? 'border-[#ddd8cf] bg-[#ebe7dc] text-[#55514a]'
          : 'border-[#2b2f38] bg-[#20232b] text-[#aab2c0]',
      )}
    >
      <span>{title}</span>
      <span className="max-w-[45%] truncate normal-case">{detail}</span>
    </div>
  );
}

function StatusCluster({
  currentFile,
  durationMs,
  lineCountValue,
  pluginState,
  savedAt,
  saveState,
  status,
}: {
  currentFile: string | null;
  durationMs: number | null;
  lineCountValue: number;
  pluginState: PluginState;
  savedAt: Date | null;
  saveState: SaveState;
  status: RenderStatus;
}) {
  const statusView = statusDisplay(status);
  const saveView = saveDisplay(saveState);
  const pluginView = pluginDisplay(pluginState);

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-[#2b2f38] bg-[#20232b] px-3 text-xs text-[#aab2c0]">
      <span
        id="status"
        className={cn('flex items-center gap-1.5', statusView.className)}
      >
        {statusView.icon}
        {statusView.label}
      </span>
      <span id="duration" className="flex items-center gap-1.5 tabular-nums">
        <Clock3 className="h-3.5 w-3.5" />
        {durationMs == null ? 'pending' : `${durationMs}ms`}
      </span>
      <span
        id="save-state"
        className={cn('flex items-center gap-1.5', saveView.className)}
      >
        {saveView.icon}
        {saveView.label}
      </span>
      <span
        id="plugin-state"
        className={cn('flex items-center gap-1.5', pluginView.className)}
      >
        {pluginView.icon}
        {pluginView.label}
      </span>
      {savedAt ? (
        <span
          data-testid="saved-timestamp"
          className="flex items-center gap-1.5 tabular-nums"
        >
          <Clock3 className="h-3.5 w-3.5" />
          saved {formatSavedAt(savedAt)}
        </span>
      ) : null}
      <span className="ml-auto truncate">{basename(currentFile)}</span>
      <span className="tabular-nums">{lineCountValue} lines</span>
    </footer>
  );
}

function ExplorerDrawer({
  currentFile,
  onOpenFile,
  root,
}: {
  currentFile: string | null;
  onOpenFile: (result: OpenFileResult) => Promise<boolean>;
  root: string;
}) {
  const [entriesByDir, setEntriesByDir] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true });
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(
    async (dir: string) => {
      if (entriesByDir[dir] || loading[dir]) return;
      setLoading((state) => ({ ...state, [dir]: true }));
      setError(null);
      try {
        const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        const data = (await res.json()) as { entries: FileEntry[] };
        setEntriesByDir((state) => ({ ...state, [dir]: data.entries }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading((state) => ({ ...state, [dir]: false }));
      }
    },
    [entriesByDir, loading],
  );

  useEffect(() => {
    void loadDirectory('');
  }, [loadDirectory]);

  const toggleDirectory = useCallback(
    (path: string) => {
      setExpanded((state) => ({ ...state, [path]: !state[path] }));
      void loadDirectory(path);
    },
    [loadDirectory],
  );

  const openFile = useCallback(
    async (path: string) => {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        setError(`server returned ${res.status}`);
        return;
      }
      await onOpenFile((await res.json()) as OpenFileResult);
    },
    [onOpenFile],
  );

  return (
    <motion.aside
      animate={{ opacity: 1, width: 300 }}
      className="min-h-0 shrink-0 overflow-hidden border-r border-[#2b2f38] bg-[#1b1e25]"
      data-testid="explorer-drawer"
      exit={{ opacity: 0, width: 0 }}
      initial={{ opacity: 0, width: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
    >
      <div className="flex h-full w-[300px] flex-col">
        <div className="border-b border-[#2b2f38] px-3 py-2">
          <div className="text-xs uppercase text-[#aab2c0]">Explorer</div>
          <div className="mt-1 truncate text-xs text-[#788190]" title={root}>
            {root || 'Workspace'}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-2">
          <ExplorerBranch
            currentFile={currentFile}
            entriesByDir={entriesByDir}
            expanded={expanded}
            loading={loading}
            onOpenFile={openFile}
            onToggleDirectory={toggleDirectory}
            path=""
          />
          {error ? (
            <div className="px-3 py-2 text-xs text-[#ff9b8f]">{error}</div>
          ) : null}
        </div>
      </div>
    </motion.aside>
  );
}

function ExplorerBranch({
  currentFile,
  entriesByDir,
  expanded,
  loading,
  onOpenFile,
  onToggleDirectory,
  path,
  depth = 0,
}: {
  currentFile: string | null;
  entriesByDir: Record<string, FileEntry[]>;
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;
  onOpenFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  path: string;
  depth?: number;
}) {
  const entries = entriesByDir[path] ?? [];

  return (
    <>
      {entries.map((entry) => {
        const isExpanded = Boolean(expanded[entry.path]);
        const isCurrent = currentFile?.endsWith(entry.path);
        const paddingLeft = 10 + depth * 16;

        if (entry.kind === 'directory') {
          return (
            <div key={entry.path}>
              <button
                className="flex h-7 w-full items-center gap-1.5 truncate px-2 text-left text-sm text-[#c8ced8] hover:bg-[#28303b]"
                style={{ paddingLeft }}
                type="button"
                onClick={() => onToggleDirectory(entry.path)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                {isExpanded ? (
                  <FolderOpen className="h-4 w-4 shrink-0 text-[#d7b46a]" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-[#d7b46a]" />
                )}
                <span className="truncate">{entry.name}</span>
                {loading[entry.path] ? (
                  <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />
                ) : null}
              </button>
              {isExpanded ? (
                <ExplorerBranch
                  currentFile={currentFile}
                  entriesByDir={entriesByDir}
                  expanded={expanded}
                  loading={loading}
                  onOpenFile={onOpenFile}
                  onToggleDirectory={onToggleDirectory}
                  path={entry.path}
                  depth={depth + 1}
                />
              ) : null}
            </div>
          );
        }

        return (
          <button
            key={entry.path}
            className={cn(
              'flex h-7 w-full items-center gap-2 truncate px-2 text-left text-sm hover:bg-[#28303b]',
              isCurrent ? 'bg-[#2d3a4a] text-white' : 'text-[#c8ced8]',
            )}
            style={{ paddingLeft }}
            type="button"
            onClick={() => onOpenFile(entry.path)}
          >
            <FileText className="h-4 w-4 shrink-0 text-[#8fb8ff]" />
            <span className="truncate">{entry.name}</span>
          </button>
        );
      })}
    </>
  );
}

function QuickOpenDialog({
  inputRef,
  onCancel,
  onOpenFile,
  open,
  workspaceRoot,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onOpenFile: (result: OpenFileResult) => Promise<boolean>;
  open: boolean;
  workspaceRoot: string;
}) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<QuickOpenEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    setLoading(true);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());

    let cancelled = false;
    fetch('/api/files/quick-open')
      .then((res) => {
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        return res.json() as Promise<{ entries: QuickOpenEntry[] }>;
      })
      .then((data) => {
        if (!cancelled) setEntries(data.entries ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [inputRef, open]);

  const filteredEntries = useMemo(
    () => filterQuickOpenEntries(entries, query).slice(0, 60),
    [entries, query],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    setSelectedIndex((index) =>
      filteredEntries.length === 0 ? 0 : Math.min(index, filteredEntries.length - 1),
    );
  }, [filteredEntries.length]);

  if (!open) return null;

  const openSelected = async (entry: QuickOpenEntry | undefined) => {
    if (!entry) return;
    setError(null);
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(entry.path)}`,
    );
    if (!res.ok) {
      setError(`server returned ${res.status}`);
      return;
    }
    const didOpen = await onOpenFile((await res.json()) as OpenFileResult);
    if (didOpen) onCancel();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onCancel();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((index) =>
        filteredEntries.length === 0 ? 0 : Math.min(index + 1, filteredEntries.length - 1),
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void openSelected(filteredEntries[selectedIndex]);
    }
  };

  const recentEntries = filteredEntries.filter((entry) => entry.recent);
  const workspaceEntries = filteredEntries.filter((entry) => !entry.recent);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      data-testid="quick-open-dialog"
      onClick={onCancel}
    >
      <div
        className="w-[min(720px,calc(100vw-2rem))] rounded border border-[#343946] bg-[#1f222b] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[#343946] p-3">
          <div className="mb-2 flex items-center justify-between text-sm font-medium text-[#d6d9df]">
            <span>Quick Open</span>
            <span className="max-w-[55%] truncate text-xs font-normal text-[#788190]">
              {workspaceRoot || 'Workspace'}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded border border-[#343946] bg-[#15161a] px-3 py-2 focus-within:border-[#4a7cc9]">
            <Search className="h-4 w-4 shrink-0 text-[#788190]" />
            <input
              ref={inputRef}
              aria-label="Search files"
              className="w-full bg-transparent text-sm text-[#e6e8eb] outline-none placeholder:text-[#58606e]"
              placeholder="Search files"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div className="max-h-[52vh] overflow-auto p-2">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-[#aab2c0]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading files
            </div>
          ) : null}
          {error ? <div className="px-2 py-3 text-sm text-[#ff9b8f]">{error}</div> : null}
          {!loading && !error && filteredEntries.length === 0 ? (
            <div className="px-2 py-3 text-sm text-[#aab2c0]">No matching files</div>
          ) : null}
          <QuickOpenSection
            entries={recentEntries}
            label="Recent"
            offset={0}
            selectedIndex={selectedIndex}
            onOpen={openSelected}
            onSelect={setSelectedIndex}
          />
          <QuickOpenSection
            entries={workspaceEntries}
            label="Workspace"
            offset={recentEntries.length}
            selectedIndex={selectedIndex}
            onOpen={openSelected}
            onSelect={setSelectedIndex}
          />
        </div>
      </div>
    </div>
  );
}

function QuickOpenSection({
  entries,
  label,
  offset,
  onOpen,
  onSelect,
  selectedIndex,
}: {
  entries: QuickOpenEntry[];
  label: string;
  offset: number;
  onOpen: (entry: QuickOpenEntry) => Promise<void>;
  onSelect: (index: number) => void;
  selectedIndex: number;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="py-1">
      <div className="px-2 py-1 text-xs uppercase text-[#788190]">{label}</div>
      {entries.map((entry, index) => {
        const absoluteIndex = offset + index;
        return (
          <button
            key={`${label}-${entry.path}`}
            className={cn(
              'flex h-10 w-full items-center gap-2 rounded px-2 text-left text-sm',
              absoluteIndex === selectedIndex
                ? 'bg-[#344154] text-white'
                : 'text-[#c8ced8] hover:bg-[#28303b]',
            )}
            data-testid="quick-open-result"
            type="button"
            onClick={() => void onOpen(entry)}
            onMouseEnter={() => onSelect(absoluteIndex)}
          >
            <FileText className="h-4 w-4 shrink-0 text-[#8fb8ff]" />
            <span className="min-w-0 flex-1 truncate">{entry.path}</span>
            {entry.dir ? (
              <span className="max-w-[35%] truncate text-xs text-[#788190]">
                {entry.dir}
              </span>
            ) : null}
          </button>
        );
      })}
    </section>
  );
}

function markdownExtension() {
  return markdown({ base: markdownLanguage, codeLanguages: languages });
}

function statusDisplay(status: RenderStatus) {
  switch (status) {
    case 'rendering':
      return {
        label: 'rendering',
        className: 'text-[#e5c76b]',
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      };
    case 'error':
      return {
        label: 'error',
        className: 'text-[#ff9b8f]',
        icon: <XCircle className="h-3.5 w-3.5" />,
      };
    case 'saved':
      return {
        label: 'saved',
        className: 'text-[#86d59f]',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    default:
      return {
        label: 'ready',
        className: 'text-[#86d59f]',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
  }
}

function saveDisplay(saveState: SaveState) {
  switch (saveState) {
    case 'dirty':
      return {
        label: 'unsaved',
        className: 'text-[#e5c76b]',
        icon: <Clock3 className="h-3.5 w-3.5" />,
      };
    case 'saving':
      return {
        label: 'saving',
        className: 'text-[#e5c76b]',
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      };
    case 'saved':
      return {
        label: 'saved',
        className: 'text-[#86d59f]',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    case 'error':
      return {
        label: 'save error',
        className: 'text-[#ff9b8f]',
        icon: <XCircle className="h-3.5 w-3.5" />,
      };
    default:
      return {
        label: 'idle',
        className: 'text-[#aab2c0]',
        icon: <Save className="h-3.5 w-3.5" />,
      };
  }
}

function pluginDisplay(pluginState: PluginState) {
  switch (pluginState) {
    case 'running':
      return {
        label: 'plugin running',
        className: 'text-[#e5c76b]',
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      };
    case 'complete':
      return {
        label: 'plugin complete',
        className: 'text-[#86d59f]',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    case 'error':
      return {
        label: 'plugin error',
        className: 'text-[#ff9b8f]',
        icon: <XCircle className="h-3.5 w-3.5" />,
      };
    default:
      return {
        label: 'plugins idle',
        className: 'text-[#aab2c0]',
        icon: <Plug className="h-3.5 w-3.5" />,
      };
  }
}

function groupPluginsByCategory(plugins: PluginMetadata[]) {
  const grouped = new Map<string, PluginMetadata[]>();
  for (const plugin of plugins) {
    const items = grouped.get(plugin.category) ?? [];
    items.push(plugin);
    grouped.set(plugin.category, items);
  }

  return Array.from(grouped, ([category, items]) => ({
    category,
    items: items.toSorted((a, b) => a.name.localeCompare(b.name)),
  })).toSorted((a, b) => a.category.localeCompare(b.category));
}

function filterQuickOpenEntries(entries: QuickOpenEntry[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return entries;

  return entries.filter((entry) => {
    return (
      entry.name.toLowerCase().includes(normalized) ||
      entry.path.toLowerCase().includes(normalized)
    );
  });
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function formatSavedAt(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
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

function SaveAsDialog({
  inputRef,
  mode,
  onCancel,
  onSubmit,
  open,
  workspaceRoot,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  mode: 'save' | 'new';
  onCancel: () => void;
  onSubmit: (path: string) => void;
  open: boolean;
  workspaceRoot: string;
}) {
  const [value, setValue] = useState('');
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;

  useEffect(() => {
    if (open) {
      setValue('');
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [open, ref]);

  if (!open) return null;

  const title = mode === 'new' ? 'New File' : 'Save As';
  const submitLabel = mode === 'new' ? 'Create' : 'Save';

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="min-w-80 rounded border border-[#343946] bg-[#1f222b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-medium text-[#d6d9df]">{title}</h2>
        <div className="mb-1 text-xs text-[#788190]">
          Workspace: <span className="text-[#aab2c0]">{workspaceRoot}</span>
        </div>
        <input
          ref={ref}
          autoFocus
          className="mb-4 mt-1 w-full rounded border border-[#343946] bg-[#15161a] px-3 py-2 text-sm text-[#e6e8eb] outline-none focus:border-[#4a7cc9]"
          placeholder="path/relative/to/workspace/filename.md"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex justify-end gap-2">
          <button
            className="rounded bg-[#303541] px-4 py-1.5 text-sm text-[#b9c0cc] hover:bg-[#3a4050]"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded bg-[#3f5f82] px-4 py-1.5 text-sm text-white hover:bg-[#4b6f98] disabled:opacity-40"
            disabled={!value.trim()}
            type="button"
            onClick={handleSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, ...props }) => (
        <Toast key={id} data-testid="toast" {...props}>
          <div className="grid gap-1">
            {title ? <ToastTitle>{title}</ToastTitle> : null}
            {description ? <ToastDescription>{description}</ToastDescription> : null}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]" />
    </ToastProvider>
  );
}
