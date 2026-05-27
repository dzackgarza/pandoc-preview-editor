import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Filter, Loader, Save } from 'lucide-react';

interface LuaFilter {
  name: string;
  path: string;
  enabled: boolean;
}

interface FilterSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function FilterSettingsModal({ open, onClose, onSave }: FilterSettingsModalProps) {
  const [filters, setFilters] = useState<LuaFilter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetchFilters();
    }
  }, [open]);

  const fetchFilters = () => {
    setLoading(true);
    setError(null);
    fetch('/api/filters')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch filters');
        return res.json();
      })
      .then((data) => {
        setFilters(data.filters || []);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load filters');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleToggle = (filterName: string) => {
    const updatedFilters = filters.map((f) => {
      if (f.name === filterName) {
        return { ...f, enabled: !f.enabled };
      }
      return f;
    });
    setFilters(updatedFilters);
  };

  const handleSave = () => {
    setSaving(true);
    setError(null);
    const enabledPaths = filters.filter((f) => f.enabled).map((f) => f.path);

    fetch('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabledPaths }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to update filters');
        return res.json();
      })
      .then(() => {
        onSave();
        onClose();
      })
      .catch((err) => {
        setError(err.message || 'Failed to save filters');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(val) => { if (!val) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[500px] max-h-[500px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#2b2f38] bg-[#1e222b] text-[#e6e8eb] shadow-2xl outline-none flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#2b2f38] px-4 py-3 shrink-0">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-[#f5c2e7]" />
              <Dialog.Title className="text-base font-medium">Lua Filter Configuration</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-1 hover:bg-[#303541] hover:text-white cursor-pointer transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {error && (
              <div className="rounded border border-[#e06c75]/20 bg-[#e06c75]/10 p-3 text-xs text-[#e06c75]">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-[#788190]">
                <Loader className="h-6 w-6 animate-spin text-[#8fb8ff]" />
                <span className="text-xs">Scanning filters directory...</span>
              </div>
            ) : filters.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center text-[#788190]">
                <span className="text-sm font-medium">No filters found</span>
                <span className="text-xs mt-1">Place your Lua filters in ~/.pandoc/filters/</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-[#788190] mb-1">
                  Toggle Lua filters to automatically append or remove them from the render pipeline.
                </div>
                {filters.map((filter) => (
                  <label
                    key={filter.name}
                    className="flex items-center gap-3 rounded-md border border-[#2b2f38] bg-[#171a21]/50 px-4 py-3 hover:bg-[#20242e] transition-colors cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={filter.enabled}
                      onChange={() => handleToggle(filter.name)}
                      className="h-4 w-4 rounded border-[#343946] bg-[#15161a] text-[#8fb8ff] focus:ring-[#8fb8ff] focus:ring-offset-[#1e222b] cursor-pointer"
                    />
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-sm font-medium text-[#d6d9df]">{filter.name}</span>
                      <span className="text-xs text-[#5c6370] font-mono break-all">{filter.path}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-[#2b2f38] px-4 py-3 flex justify-end gap-2 shrink-0 bg-[#171a21]/30">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded bg-[#303541] px-4 py-1.5 text-sm text-[#b9c0cc] hover:bg-[#3a4050] transition-colors cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="rounded bg-[#89b4fa] text-[#11111b] px-4 py-1.5 text-sm font-semibold hover:bg-[#b4befe] transition-all cursor-pointer flex items-center gap-1.5 shadow-md disabled:opacity-40"
            >
              {saving ? <Loader className="h-4 w-4 animate-spin text-[#11111b]" /> : <Save className="h-4 w-4 text-[#11111b]" />}
              Save Filters
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
