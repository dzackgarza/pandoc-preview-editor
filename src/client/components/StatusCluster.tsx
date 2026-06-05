import { Clock3, CheckCircle2, XCircle, Save, Plug, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils.js';

export type RenderStatus = 'idle' | 'rendering' | 'error';
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
export type PluginState = 'idle' | 'running' | 'complete' | 'error';

export function StatusCluster({
  currentFile,
  durationMs,
  lineCountValue,
  pluginState,
  savedAt,
  saveState,
  status,
  backupSaved,
}: {
  currentFile: string | null;
  durationMs: number | null;
  lineCountValue: number;
  pluginState: PluginState;
  savedAt: Date | null;
  saveState: SaveState;
  status: RenderStatus;
  backupSaved: Date | null;
}) {
  const statusView = statusDisplay(status);
  const saveView = saveDisplay(saveState);
  const pluginView = pluginDisplay(pluginState);

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-[#2b2f38] bg-[#20232b] px-3 text-xs text-[#aab2c0]">
      <span
        id="status"
        data-state={status}
        className={cn('flex items-center gap-1.5', statusView.className)}
      >
        {statusView.icon}
        {statusView.label}
      </span>
      {durationMs != null ? (
        <span id="duration" className="flex items-center gap-1.5 tabular-nums">
          <Clock3 className="h-3.5 w-3.5" />
          {durationMs}ms
        </span>
      ) : null}
      <span
        id="save-state"
        data-state={saveState}
        data-backup-saved={backupSaved ? backupSaved.getTime() : 0}
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
      <span className="ml-auto truncate" title={currentFile ?? undefined}>{currentFile}</span>
      <span className="tabular-nums">{lineCountValue} lines</span>
    </footer>
  );
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

function formatSavedAt(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}
