import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileText,
  Loader2,
  Search,
  Image as ImageIcon,
  Edit2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { cn } from '../lib/utils.js';

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

interface FigureEntry {
  id: string;
  name: string;
  path: string;
  type: string;
  createdAt: string;
  documents: string[];
}

function formatFigureDate(value: string): string {
  const numericValue = Number(value);
  const date = Number.isFinite(numericValue) ? new Date(numericValue) : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString();
}

export function ExplorerDrawer({
  currentFile,
  onOpenFile,
  root,
  view = 'explorer',
}: {
  currentFile: string | null;
  onOpenFile: (result: OpenFileResult) => Promise<boolean>;
  root: string;
  view?: 'explorer' | 'figures';
}) {
  const [entriesByDir, setEntriesByDir] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true });
  const [loadingDir, setLoadingDir] = useState<Record<string, boolean>>({});
  const [explorerError, setExplorerError] = useState<string | null>(null);

  // Figures View States
  const [figures, setFigures] = useState<FigureEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [figuresLoading, setFiguresLoading] = useState(false);

  const loadDirectory = useCallback(
    async (dir: string) => {
      if (entriesByDir[dir] || loadingDir[dir]) return;
      setLoadingDir((state) => ({ ...state, [dir]: true }));
      setExplorerError(null);
      try {
        const data = await invoke<{ entries: FileEntry[] }>('list_files', {
          dir,
        });
        setEntriesByDir((state) => ({ ...state, [dir]: data.entries }));
      } catch (err) {
        setExplorerError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingDir((state) => ({ ...state, [dir]: false }));
      }
    },
    [entriesByDir, loadingDir],
  );

  useEffect(() => {
    if (view === 'explorer') {
      void loadDirectory('');
    } else if (view === 'figures') {
      setFiguresLoading(true);
      invoke<{ figures: FigureEntry[] }>('figures_registry')
        .then((data) => {
          setFigures(data.figures);
        })
        .catch((err: unknown) => {
          setExplorerError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setFiguresLoading(false));
    }
  }, [view, loadDirectory]);

  const toggleDirectory = useCallback(
    (path: string) => {
      setExpanded((state) => ({ ...state, [path]: !state[path] }));
      void loadDirectory(path);
    },
    [loadDirectory],
  );

  const openFile = useCallback(
    async (path: string) => {
      try {
        const data = await invoke<OpenFileResult>('file_content', { path });
        await onOpenFile(data);
      } catch (err) {
        setExplorerError(err instanceof Error ? err.message : String(err));
      }
    },
    [onOpenFile],
  );

  const handleEditFigure = (path: string, type: string) => {
    invoke('launch_diagram', { absolutePath: path, kind: type }).catch((err: unknown) => {
      setExplorerError(err instanceof Error ? err.message : String(err));
    });
  };

  const filteredFigures = figures.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <motion.aside
      animate={{ opacity: 1, width: 300 }}
      className="min-h-0 shrink-0 overflow-hidden border-r border-[#2b2f38] bg-[#1b1e25] flex flex-col h-full"
      data-testid="explorer-drawer"
      exit={{ opacity: 0, width: 0 }}
      initial={{ opacity: 0, width: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
    >
      <div className="flex h-full w-[300px] flex-col overflow-hidden">
        {view === 'explorer' ? (
          <>
            <div className="border-b border-[#2b2f38] px-4 py-3 shrink-0 bg-[#171a21]/30">
              <div className="text-xs uppercase text-[#aab2c0] font-semibold tracking-wider">
                Explorer
              </div>
              <div className="mt-1 truncate text-xs text-[#788190]" title={root}>
                {root || 'Workspace'}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto py-2">
              <ExplorerBranch
                currentFile={currentFile}
                entriesByDir={entriesByDir}
                expanded={expanded}
                loading={loadingDir}
                onOpenFile={openFile}
                onToggleDirectory={toggleDirectory}
                path=""
                root={root}
              />
              {explorerError ? (
                <div className="px-3 py-2 text-xs text-[#ff9b8f]">{explorerError}</div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col overflow-hidden">
            <div className="border-b border-[#2b2f38] px-4 py-3 flex flex-col gap-2.5 shrink-0 bg-[#171a21]/30">
              <div className="text-xs uppercase text-[#aab2c0] font-semibold tracking-wider">
                Figures Library
              </div>
              <div className="relative">
                <input
                  placeholder="Search figures..."
                  className="w-full rounded-md border border-[#2b2f38] bg-[#15171d] pl-8 pr-3 py-1.5 text-xs text-[#e6e8eb] outline-none focus:border-[#3b82f6] transition-colors"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[#5c6370]" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
              {figuresLoading ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-[#788190] text-xs">
                  <Loader2 className="h-5 w-5 animate-spin text-[#3b82f6]" />
                  <span>Scanning workspace figures...</span>
                </div>
              ) : filteredFigures.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center text-center text-[#788190] italic text-xs p-4">
                  No figures found under workspace <code>figures/</code> directories.
                </div>
              ) : (
                filteredFigures.map((fig) => (
                  <div
                    key={fig.id}
                    className="group rounded-lg border border-[#2b2f38] bg-[#171a21]/40 p-3.5 flex flex-col gap-2 hover:border-[#3b82f6]/40 hover:bg-[#20242e]/30 transition-all shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        title={fig.name}
                        className="text-xs font-semibold text-[#d6d9df] truncate max-w-[150px]"
                      >
                        {fig.name}
                      </span>
                      <span className="rounded bg-[#2a2f3a] px-2 py-0.5 text-[9px] font-mono text-[#8fb8ff] tracking-wide uppercase">
                        {fig.type}
                      </span>
                    </div>
                    <div
                      className="text-[10px] text-[#5c6370] truncate font-mono"
                      title={fig.path}
                    >
                      {fig.path}
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#2b2f38]/30">
                      <span className="text-[9px] text-[#788190] font-medium">
                        {formatFigureDate(fig.createdAt)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleEditFigure(fig.path, fig.type)}
                        className="rounded bg-[#3b82f6]/20 text-[#8fb8ff] hover:bg-[#3b82f6] hover:text-white px-2.5 py-1 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all shadow-sm"
                      >
                        <Edit2 className="h-3 w-3" />
                        Edit
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}

function resolveClientPath(root: string, relPath: string): string {
  if (!root) return relPath;
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  const normalizedRel = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return `${normalizedRoot}/${normalizedRel}`;
}

function ExplorerBranch({
  currentFile,
  entriesByDir,
  expanded,
  loading,
  onOpenFile,
  onToggleDirectory,
  path,
  root,
  depth = 0,
}: {
  currentFile: string | null;
  entriesByDir: Record<string, FileEntry[]>;
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;
  onOpenFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  path: string;
  root: string;
  depth?: number;
}) {
  const entries = entriesByDir[path] ?? [];

  return (
    <>
      {entries.map((entry) => {
        const isExpanded = Boolean(expanded[entry.path]);
        const entryAbsolute = resolveClientPath(root, entry.path);
        const isCurrent = currentFile === entryAbsolute;
        const paddingLeft = 10 + depth * 16;

        if (entry.kind === 'directory') {
          return (
            <div key={entry.path}>
              <button
                className="flex h-7 w-full items-center gap-1.5 truncate px-2 text-left text-sm text-[#c8ced8] hover:bg-[#28303b] cursor-pointer"
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
                  root={root}
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
              'flex h-7 w-full items-center gap-2 truncate px-2 text-left text-sm hover:bg-[#28303b] cursor-pointer',
              isCurrent
                ? 'bg-[#2d3a4a] text-white font-semibold border-l-2 border-[#3b82f6]'
                : 'text-[#c8ced8]',
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
