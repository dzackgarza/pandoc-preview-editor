import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { X, Settings, Cpu, FolderOpen, Terminal } from 'lucide-react';
import { parse } from 'shell-quote';

interface SettingsData {
  templatesDir: string;
  filtersDir: string;
  debounceMs: number;
  timeoutMs: number;
  renderCommand: string;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

interface ParsedFlags {
  commandName: string;
  standalone: boolean;
  citeproc: boolean;
  toc: boolean;
  numberSections: boolean;
  embedResources: boolean;
  math: 'mathjax' | 'katex' | 'webtex' | 'none';
  selectedTemplate: string;
  selectedFilters: string[];
  otherFlags: string[];
}

// Parse a raw command string into its constituent flags.
// Uses shell-quote so quoted arguments (e.g. paths with spaces) are handled correctly.
function parseFlags(rawText: string): ParsedFlags {
  const tokens = parse(rawText).filter((t): t is string => typeof t === 'string');
  const [commandName = 'pandoc', ...args] = tokens;

  let standalone = false;
  let citeproc = false;
  let toc = false;
  let numberSections = false;
  let embedResources = false;
  let math: ParsedFlags['math'] = 'none';
  let selectedTemplate = '';
  const selectedFilters: string[] = [];
  const otherFlags: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-s' || arg === '--standalone') {
      standalone = true;
    } else if (arg === '--citeproc') {
      citeproc = true;
    } else if (arg === '-N' || arg === '--number-sections') {
      numberSections = true;
    } else if (arg === '--table-of-contents' || arg === '--toc') {
      toc = true;
    } else if (arg === '--self-contained' || arg === '--embed-resources') {
      embedResources = true;
    } else if (arg === '--mathjax') {
      math = 'mathjax';
    } else if (arg === '--katex') {
      math = 'katex';
    } else if (arg === '--webtex') {
      math = 'webtex';
    } else if (arg.startsWith('--template=')) {
      const val = arg.slice('--template='.length);
      selectedTemplate = val.split('/').at(-1) || val;
    } else if (arg === '--template' && i + 1 < args.length) {
      const val = args[++i];
      selectedTemplate = val.split('/').at(-1) || val;
    } else if (arg.startsWith('--lua-filter=')) {
      const val = arg.slice('--lua-filter='.length);
      selectedFilters.push(val.split('/').at(-1) || val);
    } else if (arg === '--lua-filter' && i + 1 < args.length) {
      const val = args[++i];
      selectedFilters.push(val.split('/').at(-1) || val);
    } else if (arg.startsWith('--filter=')) {
      const val = arg.slice('--filter='.length);
      selectedFilters.push(val.split('/').at(-1) || val);
    } else if (arg === '--filter' && i + 1 < args.length) {
      const val = args[++i];
      selectedFilters.push(val.split('/').at(-1) || val);
    } else {
      otherFlags.push(arg);
    }
  }

  return { commandName, standalone, citeproc, toc, numberSections, embedResources, math, selectedTemplate, selectedFilters, otherFlags };
}

// Reconstruct a raw command string from parsed flag state.
function buildCommand(flags: ParsedFlags, templatesDir: string, filtersDir: string): string {
  const args: string[] = [];
  if (flags.standalone) args.push('--standalone');
  if (flags.citeproc) args.push('--citeproc');
  if (flags.toc) args.push('--table-of-contents');
  if (flags.numberSections) args.push('--number-sections');
  if (flags.embedResources) args.push('--embed-resources');
  if (flags.math === 'mathjax') args.push('--mathjax');
  if (flags.math === 'katex') args.push('--katex');
  if (flags.math === 'webtex') args.push('--webtex');
  if (flags.selectedTemplate) {
    args.push(`--template=${templatesDir.replace(/\/$/, '')}/${flags.selectedTemplate}`);
  }
  for (const filter of flags.selectedFilters) {
    const ext = filter.endsWith('.lua') ? '--lua-filter' : '--filter';
    args.push(`${ext}=${filtersDir.replace(/\/$/, '')}/${filter}`);
  }
  args.push(...flags.otherFlags);
  return [flags.commandName, ...args].join(' ');
}

export function SettingsDialog({ open, onClose, onSave }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState('general');

  // Scanned assets
  const [availableTemplates, setAvailableTemplates] = useState<string[]>([]);
  const [availableFilters, setAvailableFilters] = useState<string[]>([]);

  // Config state
  const [templatesDir, setTemplatesDir] = useState('~/.pandoc/templates');
  const [filtersDir, setFiltersDir] = useState('~/.pandoc/filters');
  const [debounceMs, setDebounceMs] = useState(750);
  const [timeoutMs, setTimeoutMs] = useState(30000);

  // Raw command string — single source of truth for all flag state
  const [rawArgsText, setRawArgsText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // All flag state derived from rawArgsText; no separate per-flag state vars
  const parsedFlags = useMemo(
    () => parseFlags(rawArgsText),
    [rawArgsText],
  );

  // Fetch config and asset lists when the dialog opens
  useEffect(() => {
    if (open) {
      setValidationError(null);
      fetch('/api/config')
        .then((res) => res.json())
        .then((data: SettingsData) => {
          setTemplatesDir(data.templatesDir);
          setFiltersDir(data.filtersDir);
          setDebounceMs(data.debounceMs);
          setTimeoutMs(data.timeoutMs);
          setRawArgsText(data.renderCommand || 'pandoc');
        })
        .catch(console.error);

      fetch('/api/pandoc/assets')
        .then((res) => res.json())
        .then((data: { templates: string[]; filters: string[] }) => {
          setAvailableTemplates(data.templates);
          setAvailableFilters(data.filters);
        })
        .catch(console.error);
    }
  }, [open]);

  // Update a single flag: rebuild the raw command string from the new flag state
  const updateFlag = (patch: Partial<ParsedFlags>) => {
    setRawArgsText(buildCommand({ ...parsedFlags, ...patch }, templatesDir, filtersDir));
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

    const payload = {
      templatesDir,
      filtersDir,
      debounceMs: Number(debounceMs),
      timeoutMs: Number(timeoutMs),
      renderCommand: rawArgsText,
    };

    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          onSave();
          onClose();
        } else {
          setValidationError(data.error || 'Failed to save configuration');
        }
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[600px] h-[500px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#2b2f38] bg-[#1e222b] text-[#e6e8eb] shadow-2xl outline-none flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#2b2f38] px-4 py-3 shrink-0">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-[#8fb8ff]" />
              <Dialog.Title className="text-base font-medium">Preferences</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-1 hover:bg-[#303541] hover:text-white cursor-pointer"
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
            <Tabs.List className="w-44 border-r border-[#2b2f38] bg-[#171a21] py-2 flex flex-col gap-1 shrink-0">
              <Tabs.Trigger
                value="general"
                className="flex items-center gap-2 px-4 py-2 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <Cpu className="h-4 w-4" />
                General
              </Tabs.Trigger>
              <Tabs.Trigger
                value="flags"
                className="flex items-center gap-2 px-4 py-2 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <Terminal className="h-4 w-4" />
                Pandoc Flags
              </Tabs.Trigger>
              <Tabs.Trigger
                value="assets"
                className="flex items-center gap-2 px-4 py-2 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <FolderOpen className="h-4 w-4" />
                Templates & Filters
              </Tabs.Trigger>
              <Tabs.Trigger
                value="raw"
                className="flex items-center gap-2 px-4 py-2 text-left text-sm outline-none transition-colors w-full cursor-pointer text-[#a9b2c3] hover:bg-[#1f2229] hover:text-[#e6e8eb] data-[state=active]:bg-[#2a2f3a] data-[state=active]:text-white data-[state=active]:font-medium data-[state=active]:border-l-2 data-[state=active]:border-[#3b82f6]"
              >
                <Terminal className="h-4 w-4" />
                Raw Command
              </Tabs.Trigger>
            </Tabs.List>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-4">
              {validationError && (
                <div className="mb-4 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">
                  {validationError}
                </div>
              )}

              {/* General Tab */}
              <Tabs.Content
                value="general"
                className="flex flex-col gap-4 outline-none"
              >
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#8a92a3]">
                    DEBOUNCE DURATION (MS)
                  </label>
                  <input
                    className="w-full rounded border border-[#2b2f38] bg-[#15171d] px-3 py-1.5 text-sm text-[#e6e8eb] outline-none focus:border-[#6aa8ff]"
                    type="number"
                    value={debounceMs}
                    onChange={(e) => setDebounceMs(Number(e.target.value))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#8a92a3]">
                    TIMEOUT DURATION (MS)
                  </label>
                  <input
                    className="w-full rounded border border-[#2b2f38] bg-[#15171d] px-3 py-1.5 text-sm text-[#e6e8eb] outline-none focus:border-[#6aa8ff]"
                    type="number"
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(Number(e.target.value))}
                  />
                </div>
              </Tabs.Content>

              {/* Pandoc Flags Tab */}
              <Tabs.Content value="flags" className="flex flex-col gap-4 outline-none">
                <div className="flex flex-col gap-3">
                  <label className="text-xs font-semibold text-[#8a92a3]">
                    COMMON RENDERING FLAGS
                  </label>
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

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#8a92a3]">
                    MATH RENDERER ENGINE
                  </label>
                  <select
                    className="w-full rounded border border-[#2b2f38] bg-[#15171d] px-3 py-1.5 text-sm text-[#e6e8eb] outline-none focus:border-[#6aa8ff]"
                    value={parsedFlags.math}
                    onChange={(e) => updateFlag({ math: e.target.value as ParsedFlags['math'] })}
                  >
                    <option value="none">None</option>
                    <option value="mathjax">MathJax (--mathjax)</option>
                    <option value="katex">KaTeX (--katex)</option>
                    <option value="webtex">WebTeX (--webtex)</option>
                  </select>
                </div>
              </Tabs.Content>

              {/* Templates & Filters Tab */}
              <Tabs.Content value="assets" className="flex flex-col gap-4 outline-none">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#8a92a3]">
                    TEMPLATES DIRECTORY
                  </label>
                  <input
                    className="w-full rounded border border-[#2b2f38] bg-[#15171d] px-3 py-1.5 text-sm text-[#e6e8eb] outline-none focus:border-[#6aa8ff]"
                    type="text"
                    value={templatesDir}
                    onChange={(e) => setTemplatesDir(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#8a92a3]">
                    CHOOSE PREVIEW TEMPLATE
                  </label>
                  <select
                    className="w-full rounded border border-[#2b2f38] bg-[#15171d] px-3 py-1.5 text-sm text-[#e6e8eb] outline-none focus:border-[#6aa8ff]"
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

                <div className="my-1 border-t border-[#2b2f38]" />

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#8a92a3]">
                    FILTERS DIRECTORY
                  </label>
                  <input
                    className="w-full rounded border border-[#2b2f38] bg-[#15171d] px-3 py-1.5 text-sm text-[#e6e8eb] outline-none focus:border-[#6aa8ff]"
                    type="text"
                    value={filtersDir}
                    onChange={(e) => setFiltersDir(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[#8a92a3]">
                    CHOOSE LUA / BINARY FILTERS
                  </label>
                  <div className="max-h-36 overflow-y-auto rounded border border-[#2b2f38] bg-[#15171d] p-2 flex flex-col gap-2">
                    {availableFilters.length === 0 ? (
                      <div className="text-xs text-[#788190] italic p-1">
                        No filters found in directory
                      </div>
                    ) : (
                      availableFilters.map((filt) => (
                        <Checkbox
                          key={filt}
                          checked={parsedFlags.selectedFilters.includes(filt)}
                          label={filt}
                          onChange={() => handleFilterToggle(filt)}
                        />
                      ))
                    )}
                  </div>
                </div>
              </Tabs.Content>

              {/* Raw Command Tab */}
              <Tabs.Content
                value="raw"
                className="flex h-full flex-col gap-2 outline-none"
              >
                <label className="text-xs font-semibold text-[#8a92a3]">
                  Render Command
                </label>
                <textarea
                  aria-label="Render Command"
                  className="w-full flex-1 rounded border border-[#2b2f38] bg-[#15171d] p-3 font-mono text-sm text-[#e6e8eb] outline-none focus:border-[#6aa8ff] resize-none h-60"
                  value={rawArgsText}
                  onChange={(e) => handleRawTextChange(e.target.value)}
                />
                <p className="text-xs text-[#788190]">
                  Changes in raw arguments automatically update the options checkboxes,
                  and vice-versa.
                </p>
              </Tabs.Content>
            </div>
          </Tabs.Root>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-[#2b2f38] bg-[#171a21] px-4 py-3 shrink-0">
            <Dialog.Close asChild>
              <button
                className="rounded bg-[#2a2f3a] px-4 py-1.5 text-sm font-medium text-[#d6d9df] hover:bg-[#343946] focus:outline focus:outline-2 focus:outline-[#6aa8ff] cursor-pointer"
                type="button"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              className="rounded bg-[#3b82f6] px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 focus:outline focus:outline-2 focus:outline-blue-400 cursor-pointer"
              type="button"
              onClick={handleSave}
            >
              Apply
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
    <label className="flex select-none items-center gap-2.5 text-sm text-[#e6e8eb] cursor-pointer">
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
