import { useEffect, useRef, useState } from 'react';

export function SaveAsDialog({
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
