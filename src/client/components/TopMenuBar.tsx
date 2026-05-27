import * as Menubar from '@radix-ui/react-menubar';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  FilePlus,
  FolderOpen,
  Search,
  Save,
  PanelLeftOpen,
  RefreshCcw,
  BookOpen,
  Image as ImageIcon,
  ChevronRight,
  Plug,
  FileText,
  Settings,
} from 'lucide-react';
import { useMemo } from 'react';

export type PluginMetadata = {
  id: string;
  name: string;
  description: string;
  category: string;
};

export function TopMenuBar({
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
  onOpenSettings,
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
  onOpenSettings: () => void;
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
              <MenuItem onSelect={onOpenSettings}>
                <Settings className="h-4 w-4" />
                Preferences...
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
                            <FileText className="h-4 w-4 shrink-0 text-[#8fb8ff]" />
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
