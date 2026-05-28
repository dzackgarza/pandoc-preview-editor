export function UnsavedChangesDialog({
  open,
  onCancel,
  onSave,
  onDiscard,
}: {
  open: boolean;
  onCancel: () => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="min-w-80 rounded border border-[#343946] bg-[#1f222b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-medium text-[#d6d9df]">Unsaved Changes</h2>
        <div className="mb-4 text-xs text-[#788190]">
          You have unsaved changes. Do you want to save them before proceeding?
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="rounded bg-[#303541] px-4 py-1.5 text-sm text-[#b9c0cc] hover:bg-[#3a4050]"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded bg-[#8e3a3a] px-4 py-1.5 text-sm text-white hover:bg-[#a34444]"
            type="button"
            onClick={onDiscard}
          >
            Discard
          </button>
          <button
            className="rounded bg-[#3f5f82] px-4 py-1.5 text-sm text-white hover:bg-[#4b6f98]"
            type="button"
            onClick={onSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
