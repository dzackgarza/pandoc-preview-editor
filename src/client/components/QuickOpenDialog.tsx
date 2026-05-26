import { Search, FileText, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState, useRef } from 'react';
import { cn } from '../lib/utils.js';

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

export function QuickOpenDialog({
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
