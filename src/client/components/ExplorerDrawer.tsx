import { Folder, FolderOpen, ChevronRight, ChevronDown, FileText, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
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

export function ExplorerDrawer({
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
