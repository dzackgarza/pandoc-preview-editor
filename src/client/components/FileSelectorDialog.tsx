import { useCallback, useEffect, useRef, useState } from 'react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

// ─── Types ───────────────────────────────────────────────────────────────────

type BrowseEntry = {
  name: string;
  absolutePath: string;
  kind: 'directory' | 'file';
};

type BrowseResult = {
  dir: string;
  parent: string | null;
  entries: BrowseEntry[];
};

/** Flat node shape required by react-arborist */
type TreeNode = {
  id: string; // absolutePath
  name: string;
  kind: 'directory' | 'file';
};

// ─── Component ───────────────────────────────────────────────────────────────

export function FileSelectorDialog({
  mode,
  onCancel,
  onSubmit,
  open,
  workspaceRoot,
}: {
  mode: 'save' | 'new';
  onCancel: () => void;
  onSubmit: (absolutePath: string) => void;
  open: boolean;
  workspaceRoot: string;
}) {
  const [currentDir, setCurrentDir] = useState(workspaceRoot);
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const title = mode === 'new' ? 'New File' : 'Save As';
  const submitLabel = mode === 'new' ? 'Create' : 'Save';

  // ── Reset on open ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setCurrentDir(workspaceRoot);
      setFilename('');
      setError(null);
    }
  }, [open, workspaceRoot]);

  // ── Fetch directory listing whenever currentDir changes ────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/browse?dir=${encodeURIComponent(currentDir)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`server returned ${res.status}`);
        return res.json() as Promise<BrowseResult>;
      })
      .then((data) => {
        if (!cancelled) setBrowse(data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentDir]);

  // ── Focus input on open ────────────────────────────────────────────────────
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // ── Breadcrumb segments ────────────────────────────────────────────────────
  const segments = buildBreadcrumb(currentDir);

  // ── Tree data ──────────────────────────────────────────────────────────────
  const treeData: TreeNode[] = (browse?.entries ?? []).map((e) => ({
    id: e.absolutePath,
    name: e.name,
    kind: e.kind,
  }));

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleDirClick = useCallback((absPath: string) => {
    setCurrentDir(absPath);
  }, []);

  const handleFileClick = useCallback((name: string) => {
    setFilename(name);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = filename.trim();
    if (!trimmed) return;
    // Absolute path wins; otherwise join with current directory.
    const target = trimmed.startsWith('/') ? trimmed : `${currentDir}/${trimmed}`;

    if (mode === 'save') {
      try {
        const res = await fetch(`/api/files/exists?path=${encodeURIComponent(target)}`);
        if (res.ok) {
          const data = (await res.json()) as { exists: boolean };
          if (data.exists) {
            const confirmOverwrite = window.confirm(
              `"${trimmed}" already exists. Do you want to replace it?`,
            );
            if (!confirmOverwrite) return;
          }
        }
      } catch {
        // Proceed on failure
      }
    }

    onSubmit(target);
  }, [filename, currentDir, onSubmit, mode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSubmit();
      if (e.key === 'Escape') onCancel();
    },
    [handleSubmit, onCancel],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
      data-testid="file-selector-dialog"
    >
      <div
        className="flex w-[600px] max-w-[95vw] flex-col rounded-lg border border-[#2f3440] bg-[#1a1d24] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '80vh' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-[#2f3440] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#d6d9df]">{title}</h2>
          <button
            className="rounded p-0.5 text-[#788190] hover:bg-[#2b2f38] hover:text-[#d6d9df]"
            type="button"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Breadcrumb ── */}
        <div
          className="flex flex-wrap items-center gap-0.5 border-b border-[#2f3440] bg-[#16181f] px-3 py-2"
          data-testid="breadcrumb"
        >
          {segments.map((seg, i) => {
            const isLast = i === segments.length - 1;
            return (
              <span key={seg.absolutePath} className="flex items-center gap-0.5">
                {i > 0 && (
                  <ChevronRight className="h-3 w-3 shrink-0 text-[#4a5060]" />
                )}
                {isLast ? (
                  <span className="max-w-[160px] truncate text-xs font-medium text-[#c8ced8]">
                    {seg.label}
                  </span>
                ) : (
                  <button
                    className="max-w-[120px] truncate rounded px-1 text-xs text-[#788190] hover:bg-[#23262f] hover:text-[#aab2c0]"
                    type="button"
                    onClick={() => handleDirClick(seg.absolutePath)}
                  >
                    {seg.label}
                  </button>
                )}
              </span>
            );
          })}
        </div>

        {/* ── File tree ── */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[#4a5060]" />
            </div>
          ) : error ? (
            <div className="px-4 py-3 text-xs text-[#ff9b8f]">{error}</div>
          ) : treeData.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-xs text-[#4a5060]">
              Empty directory
            </div>
          ) : (
            <Tree
              data={treeData}
              width={600}
              height={280}
              rowHeight={32}
              indent={16}
              disableDrag
              disableDrop
              disableEdit
              disableMultiSelection
            >
              {(props) => (
                <FileTreeRow
                  {...props}
                  onDirClick={handleDirClick}
                  onFileClick={handleFileClick}
                />
              )}
            </Tree>
          )}
        </div>

        {/* ── Filename input ── */}
        <div className="border-t border-[#2f3440] px-4 py-3">
          <div className="mb-1.5 text-xs text-[#788190]">
            Saving to:{' '}
            <span className="font-mono text-[#9aa3b0]">{currentDir}</span>
          </div>
          <input
            ref={inputRef}
            data-testid="file-selector-input"
            className="w-full rounded border border-[#343946] bg-[#13151b] px-3 py-2 font-mono text-sm text-[#e6e8eb] outline-none placeholder:text-[#4a5060] focus:border-[#4a7cc9]"
            placeholder="filename.md  or  /absolute/path/file.md"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              className="rounded bg-[#2b2f38] px-4 py-1.5 text-sm text-[#b9c0cc] hover:bg-[#363b47]"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              data-testid="file-selector-save"
              className="rounded bg-[#3f5f82] px-4 py-1.5 text-sm text-white hover:bg-[#4b6f98] disabled:opacity-40"
              disabled={!filename.trim()}
              type="button"
              onClick={handleSubmit}
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tree row renderer ────────────────────────────────────────────────────────

function FileTreeRow({
  node,
  style,
  onDirClick,
  onFileClick,
}: NodeRendererProps<TreeNode> & {
  onDirClick: (absolutePath: string) => void;
  onFileClick: (name: string) => void;
}) {
  const isDir = node.data.kind === 'directory';

  return (
    <div
      style={style}
      className={cn(
        'flex cursor-pointer items-center gap-2 px-3 text-sm hover:bg-[#23262f]',
        isDir ? 'text-[#c8ced8]' : 'text-[#9aa3b0]',
      )}
      data-testid={isDir ? 'file-selector-dir' : 'file-selector-file'}
      onClick={() => {
        if (isDir) {
          onDirClick(node.data.id);
        } else {
          onFileClick(node.data.name);
        }
      }}
    >
      {isDir ? (
        node.isOpen ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-[#d7b46a]" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-[#d7b46a]" />
        )
      ) : (
        <FileText className="h-4 w-4 shrink-0 text-[#8fb8ff]" />
      )}
      <span className="truncate">{node.data.name}</span>
    </div>
  );
}

// ─── Breadcrumb helper ────────────────────────────────────────────────────────

type BreadcrumbSegment = { label: string; absolutePath: string };

function buildBreadcrumb(absolutePath: string): BreadcrumbSegment[] {
  const parts = absolutePath.split('/').filter(Boolean);
  const segments: BreadcrumbSegment[] = [];
  // Always include filesystem root
  segments.push({ label: '/', absolutePath: '/' });
  let accumulated = '';
  for (const part of parts) {
    accumulated += '/' + part;
    segments.push({ label: part, absolutePath: accumulated });
  }
  return segments;
}
