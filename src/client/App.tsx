import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { keymap } from '@codemirror/view';
import * as Menubar from '@radix-ui/react-menubar';
import * as Toast from '@radix-ui/react-toast';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  Loader2,
  PanelLeftOpen,
  Plug,
  RefreshCcw,
  Save,
  X,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { basename, cn, lineCount } from './lib/utils.js';

type RenderStatus = 'ready' | 'rendering' | 'error' | 'saved';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
type PluginState = 'idle' | 'running' | 'complete' | 'error';

type ToastMessage = {
  id: string;
  title: string;
  body: string;
  variant: 'success' | 'error';
  createdAt: number;
};

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
    __WORKSPACE_ROOT?: string;
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
  const [previewHtml, setPreviewHtml] = useState('');
  const [status, setStatus] = useState<RenderStatus>('ready');
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [pluginState, setPluginState] = useState<PluginState>('idle');
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const renderVersion = useRef(0);
  const debounceTimer = useRef<number | null>(null);
  const groupRef = useGroupRef();

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

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

  const saveCurrent = useCallback(async () => {
    const text = markdownText;
    renderImmediate(text);
    setSaveState('saving');

    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: text, path: currentFile }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        path?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `server returned ${res.status}`);
      }

      setCurrentFile(data.path ?? currentFile);
      setSaveState('saved');
      setStatus('saved');
    } catch (err) {
      setSaveState('error');
      setStatus('error');
    }
  }, [currentFile, markdownText, renderImmediate]);

  const runPluginAction = useCallback(
    async (pluginId: string) => {
      const pluginMeta = plugins.find((p) => p.id === pluginId);
      setPluginState('running');
      setSaveState('saving');

      try {
        const res = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: markdownText, path: currentFile }),
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
        setPluginState('complete');

        setToasts((prev) => [
          {
            id: crypto.randomUUID(),
            title: pluginMeta?.name ?? pluginId,
            body: data.stderr
              ? `stderr: ${data.stderr.slice(0, 200)}`
              : 'completed successfully',
            variant: 'success' as const,
            createdAt: Date.now(),
          },
          ...prev,
        ]);
      } catch (err) {
        setSaveState('error');
        setPluginState('error');
        setStatus('error');

        const message = err instanceof Error ? err.message : String(err);
        setToasts((prev) => [
          {
            id: crypto.randomUUID(),
            title: pluginMeta?.name ?? pluginId,
            body: message,
            variant: 'error' as const,
            createdAt: Date.now(),
          },
          ...prev,
        ]);
      }
    },
    [currentFile, markdownText, plugins],
  );

  const createNewFile = useCallback(async () => {
    setSaveState('saving');

    try {
      const res = await fetch('/api/files/new', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as OpenFileResult & {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok || !data.ok || typeof data.absolutePath !== 'string') {
        throw new Error(data.error ?? `server returned ${res.status}`);
      }

      setMarkdownText(data.content);
      setCurrentFile(data.absolutePath);
      setSaveState('saved');
      setStatus('saved');
    } catch (err) {
      setSaveState('error');
      setStatus('error');
    }
  }, []);

  const updateMarkdown = useCallback((value: string) => {
    setMarkdownText(value);
    setSaveState('dirty');
  }, []);

  const openFile = useCallback((result: OpenFileResult) => {
    setMarkdownText(result.content);
    setCurrentFile(result.absolutePath);
    setSaveState('idle');
  }, []);

  const resetSplit = useCallback(() => {
    groupRef.current?.setLayout(RESET_LAYOUT);
  }, [groupRef]);

  return (
    <Tooltip.Provider delayDuration={250}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#15161a] text-[#e6e8eb]">
        <TopMenuBar
          explorerOpen={explorerOpen}
          onNewFile={createNewFile}
          onOpenExplorer={() => setExplorerOpen(true)}
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
                root={window.__WORKSPACE_ROOT ?? ''}
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
          saveState={saveState}
          status={status}
        />
        <Toasts toasts={toasts} onDismiss={dismissToast} />
      </div>
    </Tooltip.Provider>
  );
}

function TopMenuBar({
  explorerOpen,
  onNewFile,
  onOpenExplorer,
  onRunPlugin,
  onResetSplit,
  onSave,
  onToggleExplorer,
  plugins,
}: {
  explorerOpen: boolean;
  onNewFile: () => void;
  onOpenExplorer: () => void;
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
  onSave,
}: {
  fileName: string;
  markdown: string;
  onChange: (value: string) => void;
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
  saveState,
  status,
}: {
  currentFile: string | null;
  durationMs: number | null;
  lineCountValue: number;
  pluginState: PluginState;
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
  onOpenFile: (result: OpenFileResult) => void;
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
      onOpenFile((await res.json()) as OpenFileResult);
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

function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  return (
    <Toast.Provider swipeDirection="right">
      {toasts.map((toast) => (
        <Toast.Root
          key={toast.id}
          className={cn(
            'data-[state=open]:animate-slide-in data-[state=closed]:animate-hide data-[swipe=end]:animate-swipe-out flex items-start gap-3 rounded-lg border p-3 text-sm shadow-lg',
            toast.variant === 'success'
              ? 'border-[#2d5438] bg-[#192b21] text-[#d2f0d4]'
              : 'border-[#542d2d] bg-[#2b1919] text-[#f0c2c2]',
          )}
          data-testid="toast"
          duration={Infinity}
          open
          onOpenChange={(open) => {
            if (!open) onDismiss(toast.id);
          }}
        >
          <div className="min-w-0 flex-1">
            <Toast.Title className="font-medium">{toast.title}</Toast.Title>
            <Toast.Description className="mt-0.5 text-xs opacity-80">
              {toast.body}
            </Toast.Description>
          </div>
          <Toast.Close
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport
        className="fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-2"
        data-testid="toast-container"
      />
    </Toast.Provider>
  );
}
