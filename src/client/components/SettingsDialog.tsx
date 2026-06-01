import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { X, Settings, Cpu, FolderOpen, Terminal, Filter, Plug } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import {
  ParsedFlags,
  fromRustParsedFlags,
  buildCommand,
  RustParsedFlags,
} from '../../shared/command-parser.js';

interface SettingsData {
  templatesDir: string;
  filtersDir: string;
  debounceMs: number;
  timeoutMs: number;
  renderCommand: string;
  restoreLastFile?: boolean;
  parsedFlags?: RustParsedFlags;
}

interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function SettingsDialog({ open, onClose, onSave }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState('general');

  // Scanned assets
  const [availableTemplates, setAvailableTemplates] = useState<string[]>([]);
  const [availableFilters, setAvailableFilters] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);

  // Config state
  const [templatesDir, setTemplatesDir] = useState('~/.pandoc/templates');
  const [filtersDir, setFiltersDir] = useState('~/.pandoc/filters');
  const [debounceMs, setDebounceMs] = useState(750);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [restoreLastFile, setRestoreLastFile] = useState(true);

  // Raw command string — single source of truth for all flag state
  const [rawArgsText, setRawArgsText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Flag state from Rust parser (single source of truth), kept in Settings-UI form.
  // Updated locally when user modifies structured controls; rebuilt from raw text on dialog open.
  const [parsedFlags, setParsedFlags] = useState<ParsedFlags>({
    commandName: 'pandoc',
    standalone: false,
    citeproc: false,
    toc: false,
    numberSections: false,
    embedResources: false,
    math: 'none',
    selectedTemplate: '',
    selectedFilters: [],
    otherFlags: [],
  });

  // Fetch config, plugins, and asset lists when the dialog opens
  useEffect(() => {
    if (open) {
      setValidationError(null);
      invoke<SettingsData>('get_config')
        .then((data) => {
          setTemplatesDir(data.templatesDir);
          setFiltersDir(data.filtersDir);
          setDebounceMs(data.debounceMs);
          setTimeoutMs(data.timeoutMs);
          setRawArgsText(data.renderCommand || 'pandoc');
          setRestoreLastFile(data.restoreLastFile !== false);
          if (data.parsedFlags) {
            setParsedFlags(fromRustParsedFlags(data.parsedFlags));
          }
        })
        .catch(console.error);

      invoke<{ templates: string[]; filters: string[] }>('pandoc_assets')
        .then((data) => {
          setAvailableTemplates(data.templates || []);
          setAvailableFilters(data.filters || []);
        })
        .catch(console.error);

      invoke<{ plugins: PluginMetadata[] }>('list_plugins')
        .then((data) => {
          setPlugins(data.plugins || []);
        })
        .catch(console.error);
    }
  }, [open]);

  // Update a single flag: patch local state and rebuild the raw command string
  const updateFlag = (patch: Partial<ParsedFlags>) => {
    const next = { ...parsedFlags, ...patch };
    setParsedFlags(next);
    setRawArgsText(buildCommand(next, templatesDir, filtersDir));
  };

  const handleFilterToggle = (filterName: string) => {
    const nextFilters = parsedFlags.selectedFilters.includes(filterName)
      ? parsedFlags.selectedFilters.filter((f) => f !== filterName)
      : [...parsedFlags.selectedFilters, filterName];
    updateFlag({ selectedFilters: nextFilters });
  };

  const handleRawTextChange = (text: string) => {
    setRawArgsText(text);
  };

  const handleSave = () => {
    invoke('set_config', {
      templatesDir,
      filtersDir,
      debounceMs: Number(debounceMs),
      timeoutMs: Number(timeoutMs),
      renderCommand: rawArgsText,
      restoreLastFile: restoreLastFile,
    })
      .then(() => {
        onSave();
        onClose();
      })
      .catch((err) => {
        setValidationError(err.message || 'Server error occurred');
      });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(val) => {
        if (!val) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md transition-opacity duration-300" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[92vw] h-[85vh] max-w-6xl max-h-[85vh] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#2b2f38] bg-[#1e222b]/95 backdrop-blur-xl text-[#e6e8eb] shadow-2xl outline-none flex flex-col overflow-hidden transition-all duration-300">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#2b2f38] bg-[#171a21]/50 px-6 py-4 shrink-0">
            <div className="flex items-center gap-3">
              <Settings className="h-5 w-5 text-[#8fb8ff] animate-pulse" />
              <Dialog.Title className="text-base font-semibold tracking-wide">
                Editor Settings & Preferences
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded-lg p-1.5 hover:bg-[#303541] hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Radix Tabs Container */}
          <Tabs.Root
            className="flex flex-1 overflow-hidden"
            value={activeTab}
            onValueChange={setActiveTab}
          >
            {/* Sidebar Tab Triggers */}
            <Tabs.List className="w-56 border-r border-[#2b2f38] bg-[#14171f] py-4 flex flex-col gap-1 shrink-0">
              <Tabs.Trigger
                value="general"
                className="flex items-center gap-3 px-5 py-2.5 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <Cpu className="h-4 w-4 text-[#8fb8ff]" />
                General
              </Tabs.Trigger>
              <Tabs.Trigger
                value="pandoc"
                className="flex items-center gap-3 px-5 py-2.5 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <Terminal className="h-4 w-4 text-[#a6e3a1]" />
                Pandoc Configuration
              </Tabs.Trigger>
              <Tabs.Trigger
                value="filters"
                className="flex items-center gap-3 px-5 py-2.5 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <Filter className="h-4 w-4 text-[#f9e2af]" />
                Lua Filters
              </Tabs.Trigger>
              <Tabs.Trigger
                value="assets"
                className="flex items-center gap-3 px-5 py-2.5 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <FolderOpen className="h-4 w-4 text-[#f5c2e7]" />
                Asset Resolution
              </Tabs.Trigger>
              <Tabs.Trigger
                value="raw"
                className="flex items-center gap-3 px-5 py-2.5 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <Terminal className="h-4 w-4 text-[#89dceb]" />
                Raw Command
              </Tabs.Trigger>
              <Tabs.Trigger
                value="plugins"
                className="flex items-center gap-3 px-5 py-2.5 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <Plug className="h-4 w-4 text-[#cba6f7]" />
                Plugins
              </Tabs.Trigger>
            </Tabs.List>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-6 bg-[#181a23]/30">
              {validationError && (
                <div className="mb-5 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-200 shadow-sm">
                  {validationError}
                </div>
              )}

              {/* General Tab */}
              <Tabs.Content
                value="general"
                className="flex flex-col gap-5 outline-none"
              >
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="debounce-duration-input"
                    className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase"
                  >
                    DEBOUNCE DURATION (MS)
                  </label>
                  <input
                    id="debounce-duration-input"
                    className="w-full max-w-md rounded-md border border-[#2b2f38] bg-[#15171d] px-3.5 py-2 text-sm text-[#e6e8eb] outline-none focus:border-[#3b82f6] transition-colors"
                    type="number"
                    value={debounceMs}
                    onChange={(e) => setDebounceMs(Number(e.target.value))}
                  />
                  <span className="text-[11px] text-[#788190]">
                    Delay in milliseconds between typing and launching live render
                    compilations.
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="timeout-duration-input"
                    className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase"
                  >
                    TIMEOUT DURATION (MS)
                  </label>
                  <input
                    id="timeout-duration-input"
                    className="w-full max-w-md rounded-md border border-[#2b2f38] bg-[#15171d] px-3.5 py-2 text-sm text-[#e6e8eb] outline-none focus:border-[#3b82f6] transition-colors"
                    type="number"
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(Number(e.target.value))}
                  />
                  <span className="text-[11px] text-[#788190]">
                    Max compile time before halting pandoc compilation to protect system
                    resources.
                  </span>
                </div>

                <div className="flex flex-col gap-2.5 mt-2">
                  <label className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase">
                    Session Settings
                  </label>
                  <Checkbox
                    checked={restoreLastFile}
                    label="Restore Last Active File on Startup"
                    onChange={(val) => setRestoreLastFile(val)}
                  />
                  <span className="text-[11px] text-[#788190] ml-6">
                    Automatically reload the last active markdown file and recover
                    unsaved backup buffers when launching the editor.
                  </span>
                </div>
              </Tabs.Content>

              {/* Pandoc Configuration Tab */}
              <Tabs.Content value="pandoc" className="flex flex-col gap-5 outline-none">
                <div className="flex flex-col gap-3">
                  <label className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase">
                    COMMON RENDERING FLAGS
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#15171d]/50 p-4 rounded-lg border border-[#2b2f38] max-w-2xl">
                    <Checkbox
                      checked={parsedFlags.standalone}
                      label="Standalone"
                      onChange={(val) => updateFlag({ standalone: val })}
                    />
                    <Checkbox
                      checked={parsedFlags.citeproc}
                      label="Citeproc"
                      onChange={(val) => updateFlag({ citeproc: val })}
                    />
                    <Checkbox
                      checked={parsedFlags.toc}
                      label="Table of Contents"
                      onChange={(val) => updateFlag({ toc: val })}
                    />
                    <Checkbox
                      checked={parsedFlags.numberSections}
                      label="Number Sections"
                      onChange={(val) => updateFlag({ numberSections: val })}
                    />
                    <Checkbox
                      checked={parsedFlags.embedResources}
                      label="Embed Resources"
                      onChange={(val) => updateFlag({ embedResources: val })}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 max-w-2xl">
                  <label className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase">
                    MATH RENDERER ENGINE
                  </label>
                  <select
                    className="w-full rounded-md border border-[#2b2f38] bg-[#15171d] px-3.5 py-2 text-sm text-[#e6e8eb] outline-none focus:border-[#3b82f6] cursor-pointer"
                    value={parsedFlags.math}
                    onChange={(e) =>
                      updateFlag({ math: e.target.value as ParsedFlags['math'] })
                    }
                  >
                    <option value="none">None</option>
                    <option value="mathjax">MathJax (--mathjax)</option>
                    <option value="katex">KaTeX (--katex)</option>
                    <option value="webtex">WebTeX (--webtex)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5 max-w-2xl">
                  <label className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase">
                    CHOOSE PREVIEW TEMPLATE
                  </label>
                  <select
                    className="w-full rounded-md border border-[#2b2f38] bg-[#15171d] px-3.5 py-2 text-sm text-[#e6e8eb] outline-none focus:border-[#3b82f6] cursor-pointer"
                    value={parsedFlags.selectedTemplate}
                    onChange={(e) => updateFlag({ selectedTemplate: e.target.value })}
                  >
                    <option value="">No Custom Template (Default)</option>
                    {availableTemplates.map((tpl) => (
                      <option key={tpl} value={tpl}>
                        {tpl}
                      </option>
                    ))}
                  </select>
                </div>
              </Tabs.Content>

              {/* Lua Filters Tab */}
              <Tabs.Content
                value="filters"
                className="flex flex-col gap-5 outline-none"
              >
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="filters-directory-input"
                    className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase"
                  >
                    Filters Directory
                  </label>
                  <input
                    id="filters-directory-input"
                    aria-label="Filters Directory"
                    className="w-full max-w-md rounded-md border border-[#2b2f38] bg-[#15171d] px-3.5 py-2 text-sm text-[#e6e8eb] outline-none focus:border-[#3b82f6] transition-colors"
                    type="text"
                    value={filtersDir}
                    onChange={(e) => setFiltersDir(e.target.value)}
                  />
                  <span className="text-[11px] text-[#788190]">
                    Absolute path to the centralized directory containing Lua (`.lua`)
                    and binary filters.
                  </span>
                </div>

                <div className="flex flex-col gap-2.5 mt-2 flex-1">
                  <label className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase">
                    Toggle Lua / Binary Filters
                  </label>
                  <div className="text-xs text-[#788190] mb-1">
                    Scan results of available filter files found in the directory.
                    Toggle to automatically append or remove them from the compiler
                    command.
                  </div>
                  <div className="flex-1 min-h-[200px] overflow-y-auto rounded-lg border border-[#2b2f38] bg-[#15171d]/30 p-4 flex flex-col gap-3">
                    {availableFilters.length === 0 ? (
                      <div className="flex h-32 flex-col items-center justify-center text-center text-[#788190] italic text-xs">
                        No Lua filters found in the directory. Place `.lua` filter
                        scripts in the specified folder.
                      </div>
                    ) : (
                      availableFilters.map((filt) => (
                        <label
                          key={filt}
                          className="flex items-center gap-3 rounded-md border border-[#2b2f38] bg-[#171a21]/50 px-4 py-3 hover:bg-[#20242e] transition-colors cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            checked={parsedFlags.selectedFilters.includes(filt)}
                            onChange={() => handleFilterToggle(filt)}
                            className="h-4 w-4 rounded border-[#343946] bg-[#15161a] text-[#3b82f6] focus:ring-[#3b82f6] cursor-pointer"
                          />
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className="text-sm font-medium text-[#d6d9df]">
                              {filt}
                            </span>
                            <span className="text-xs text-[#5c6370] font-mono break-all">
                              {filtersDir}/{filt}
                            </span>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </Tabs.Content>

              {/* Asset Resolution Tab */}
              <Tabs.Content value="assets" className="flex flex-col gap-5 outline-none">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="templates-directory-input"
                    className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase"
                  >
                    Templates Directory
                  </label>
                  <input
                    id="templates-directory-input"
                    aria-label="Templates Directory"
                    className="w-full max-w-md rounded-md border border-[#2b2f38] bg-[#15171d] px-3.5 py-2 text-sm text-[#e6e8eb] outline-none focus:border-[#3b82f6] transition-colors"
                    type="text"
                    value={templatesDir}
                    onChange={(e) => setTemplatesDir(e.target.value)}
                  />
                  <span className="text-[11px] text-[#788190]">
                    Absolute path to the directory containing custom Pandoc HTML and PDF
                    templates.
                  </span>
                </div>

                <div className="mt-2 rounded-md border border-[#2b2f38] bg-[#15171d] p-3.5">
                  <div className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase">
                    Figures Workflow
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-[#788190]">
                    New diagrams and pasted images are saved beside the active document in
                    <code className="mx-1 rounded bg-[#101218] px-1.5 py-0.5 text-[#c5cad3]">
                      ./figures/
                    </code>
                    . The Figures Library scans the current workspace for those files so the
                    app stays aligned with normal editor-relative asset paths.
                  </p>
                </div>
              </Tabs.Content>

              {/* Raw Command Tab */}
              <Tabs.Content
                value="raw"
                className="flex h-full flex-col gap-2.5 outline-none"
              >
                <label
                  htmlFor="raw-render-command-textarea"
                  className="text-xs font-semibold text-[#8fb8ff] tracking-wider uppercase"
                >
                  Render Command
                </label>
                <textarea
                  id="raw-render-command-textarea"
                  aria-label="Render Command"
                  className="w-full flex-1 rounded-md border border-[#2b2f38] bg-[#15171d] p-4 font-mono text-sm text-[#e6e8eb] outline-none focus:border-[#3b82f6] resize-none h-64"
                  value={rawArgsText}
                  onChange={(e) => handleRawTextChange(e.target.value)}
                />
                <p className="text-xs text-[#788190]">
                  Edit flags using the structured controls above, or paste a complete
                  command into the Raw Command tab and save. Structured controls update
                  on dialog reopen.
                </p>
              </Tabs.Content>

              {/* Plugins Tab */}
              <Tabs.Content
                value="plugins"
                className="flex h-full flex-col gap-4 outline-none overflow-y-auto"
              >
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold text-[#8fb8ff]">
                    Active Extension Plugins
                  </h3>
                  <p className="text-xs text-[#788190]">
                    Library of active plugins loaded into the host environment. Plugins
                    extend the editor with compile hooks and custom export filters.
                  </p>
                </div>

                {plugins.length === 0 ? (
                  <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-[#2b2f38] bg-[#15171d]/20 text-[#788190] text-xs">
                    No active extension plugins detected.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {plugins.map((plugin) => (
                      <div
                        key={plugin.id}
                        className="rounded-lg border border-[#2b2f38] bg-[#171a21]/50 p-4 flex flex-col gap-2 hover:border-[#3b82f6]/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#d6d9df]">
                            {plugin.name}
                          </span>
                          <span className="rounded bg-[#2a2f3a] px-2 py-0.5 text-[10px] font-mono text-[#8fb8ff]">
                            {plugin.category}
                          </span>
                        </div>
                        <div className="text-xs text-[#a9b2c3]">
                          {plugin.description}
                        </div>
                        <div className="mt-auto pt-2 border-t border-[#2b2f38]/50 text-[10px] text-[#5c6370] font-mono">
                          ID: {plugin.id}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Tabs.Content>
            </div>
          </Tabs.Root>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-[#2b2f38] bg-[#171a21]/50 px-6 py-4 shrink-0">
            <Dialog.Close asChild>
              <button
                className="rounded-lg bg-[#2a2f3a] px-5 py-2 text-sm font-medium text-[#d6d9df] hover:bg-[#343946] focus:outline focus:outline-2 focus:outline-[#3b82f6] cursor-pointer transition-colors"
                type="button"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              className="rounded-lg bg-[#3b82f6] px-5 py-2 text-sm font-semibold text-white hover:bg-blue-600 focus:outline focus:outline-2 focus:outline-blue-400 cursor-pointer transition-all shadow-md"
              type="button"
              onClick={handleSave}
            >
              Apply Settings
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Checkbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (val: boolean) => void;
}) {
  return (
    <label className="flex select-none items-center gap-2.5 text-sm text-[#e6e8eb] cursor-pointer hover:text-white transition-colors">
      <input
        aria-label={label}
        checked={checked}
        className="h-4 w-4 rounded border-[#2b2f38] bg-[#15171d] text-[#3b82f6] focus:ring-0 cursor-pointer"
        type="checkbox"
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
