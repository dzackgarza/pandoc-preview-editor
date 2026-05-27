import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { X, Settings, Cpu, FolderOpen, Terminal } from 'lucide-react';

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

export function SettingsDialog({ open, onClose, onSave }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState('general');

  // Scanned assets
  const [availableTemplates, setAvailableTemplates] = useState<string[]>([]);
  const [availableFilters, setAvailableFilters] = useState<string[]>([]);

  // Config States
  const [templatesDir, setTemplatesDir] = useState('~/.pandoc/templates');
  const [filtersDir, setFiltersDir] = useState('~/.pandoc/filters');
  const [debounceMs, setDebounceMs] = useState(750);
  const [timeoutMs, setTimeoutMs] = useState(30000);

  // GUI Flag States
  const [standalone, setStandalone] = useState(false);
  const [citeproc, setCiteproc] = useState(false);
  const [toc, setToc] = useState(false);
  const [numberSections, setNumberSections] = useState(false);
  const [embedResources, setEmbedResources] = useState(false);
  const [math, setMath] = useState<'mathjax' | 'katex' | 'webtex' | 'none'>('none');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [otherFlags, setOtherFlags] = useState<string[]>([]);

  // Command name extracted from the render command
  const [commandName, setCommandName] = useState('pandoc');

  // Raw arguments input
  const [rawArgsText, setRawArgsText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sync state tracking to prevent infinite loops
  const isSyncing = useRef(false);

  // 1. Fetch config and asset states when the dialog opens
  useEffect(() => {
    if (open) {
      setValidationError(null);
      // Fetch initial settings config
      fetch('/api/config')
        .then((res) => res.json())
        .then((data: SettingsData) => {
          setTemplatesDir(data.templatesDir);
          setFiltersDir(data.filtersDir);
          setDebounceMs(data.debounceMs);
          setTimeoutMs(data.timeoutMs);

          const parts = (data.renderCommand || 'pandoc').split(/\s+/).filter(Boolean);
          const cmd = parts[0] || 'pandoc';
          const args = parts.slice(1);
          setRawArgsText(data.renderCommand || 'pandoc');

          // Initial sync from raw args
          syncFromArgsArray(cmd, args, data.templatesDir, data.filtersDir);
        })
        .catch(console.error);

      // Fetch templates and filters assets
      fetch('/api/pandoc/assets')
        .then((res) => res.json())
        .then((data: { templates: string[]; filters: string[] }) => {
          setAvailableTemplates(data.templates);
          setAvailableFilters(data.filters);
        })
        .catch(console.error);
    }
  }, [open]);

  // Sync from raw array representation to GUI states
  const syncFromArgsArray = (
    cmd: string,
    args: string[],
    currentTDir: string,
    currentFDir: string,
  ) => {
    isSyncing.current = true;

    setCommandName(cmd);

    let isStandalone = false;
    let isCiteproc = false;
    let isToc = false;
    let isNumberSections = false;
    let isEmbedResources = false;
    let currentMath: 'mathjax' | 'katex' | 'webtex' | 'none' = 'none';
    let currentTemplate = '';
    const currentFilters: string[] = [];
    const currentOthers: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-s' || arg === '--standalone') {
        isStandalone = true;
      } else if (arg === '--citeproc') {
        isCiteproc = true;
      } else if (arg === '-N' || arg === '--number-sections') {
        isNumberSections = true;
      } else if (arg === '--table-of-contents' || arg === '--toc') {
        isToc = true;
      } else if (arg === '--self-contained' || arg === '--embed-resources') {
        isEmbedResources = true;
      } else if (arg === '--mathjax') {
        currentMath = 'mathjax';
      } else if (arg === '--katex') {
        currentMath = 'katex';
      } else if (arg === '--webtex') {
        currentMath = 'webtex';
      } else if (arg.startsWith('--template=')) {
        const val = arg.slice('--template='.length);
        currentTemplate = val.split(/[\\/]/).at(-1) || val;
      } else if (arg === '--template' && i + 1 < args.length) {
        const val = args[i + 1];
        currentTemplate = val.split(/[\\/]/).at(-1) || val;
        i++;
      } else if (arg.startsWith('--lua-filter=')) {
        const val = arg.slice('--lua-filter='.length);
        currentFilters.push(val.split(/[\\/]/).at(-1) || val);
      } else if (arg === '--lua-filter' && i + 1 < args.length) {
        const val = args[i + 1];
        currentFilters.push(val.split(/[\\/]/).at(-1) || val);
        i++;
      } else if (arg.startsWith('--filter=')) {
        const val = arg.slice('--filter='.length);
        currentFilters.push(val.split(/[\\/]/).at(-1) || val);
      } else if (arg === '--filter' && i + 1 < args.length) {
        const val = args[i + 1];
        currentFilters.push(val.split(/[\\/]/).at(-1) || val);
        i++;
      } else {
        currentOthers.push(arg);
      }
    }

    setStandalone(isStandalone);
    setCiteproc(isCiteproc);
    setToc(isToc);
    setNumberSections(isNumberSections);
    setEmbedResources(isEmbedResources);
    setMath(currentMath);
    setSelectedTemplate(currentTemplate);
    setSelectedFilters(currentFilters);
    setOtherFlags(currentOthers);

    isSyncing.current = false;
  };

  // Sync from GUI states to raw array and text representation
  const syncToRawText = (updatedState: {
    standalone: boolean;
    citeproc: boolean;
    toc: boolean;
    numberSections: boolean;
    embedResources: boolean;
    math: 'mathjax' | 'katex' | 'webtex' | 'none';
    template: string;
    selectedFilters: string[];
    otherFlags: string[];
  }) => {
    if (isSyncing.current) return;

    const args: string[] = [];
    if (updatedState.standalone) args.push('--standalone');
    if (updatedState.citeproc) args.push('--citeproc');
    if (updatedState.toc) args.push('--table-of-contents');
    if (updatedState.numberSections) args.push('--number-sections');
    if (updatedState.embedResources) args.push('--embed-resources');

    if (updatedState.math === 'mathjax') args.push('--mathjax');
    if (updatedState.math === 'katex') args.push('--katex');
    if (updatedState.math === 'webtex') args.push('--webtex');

    if (updatedState.template) {
      const cleanDir = templatesDir.replace(/\/$/, '');
      args.push(`--template=${cleanDir}/${updatedState.template}`);
    }

    for (const filter of updatedState.selectedFilters) {
      const cleanDir = filtersDir.replace(/\/$/, '');
      const ext = filter.endsWith('.lua') ? '--lua-filter' : '--filter';
      args.push(`${ext}=${cleanDir}/${filter}`);
    }

    args.push(...updatedState.otherFlags);
    setRawArgsText([commandName, ...args].join(' '));
  };

  // Handlers for individual GUI toggles
  const handleStandaloneChange = (val: boolean) => {
    setStandalone(val);
    syncToRawText({
      standalone: val,
      citeproc,
      toc,
      numberSections,
      embedResources,
      math,
      template: selectedTemplate,
      selectedFilters,
      otherFlags,
    });
  };

  const handleCiteprocChange = (val: boolean) => {
    setCiteproc(val);
    syncToRawText({
      standalone,
      citeproc: val,
      toc,
      numberSections,
      embedResources,
      math,
      template: selectedTemplate,
      selectedFilters,
      otherFlags,
    });
  };

  const handleTocChange = (val: boolean) => {
    setToc(val);
    syncToRawText({
      standalone,
      citeproc,
      toc: val,
      numberSections,
      embedResources,
      math,
      template: selectedTemplate,
      selectedFilters,
      otherFlags,
    });
  };

  const handleNumberSectionsChange = (val: boolean) => {
    setNumberSections(val);
    syncToRawText({
      standalone,
      citeproc,
      toc,
      numberSections: val,
      embedResources,
      math,
      template: selectedTemplate,
      selectedFilters,
      otherFlags,
    });
  };

  const handleEmbedResourcesChange = (val: boolean) => {
    setEmbedResources(val);
    syncToRawText({
      standalone,
      citeproc,
      toc,
      numberSections,
      embedResources: val,
      math,
      template: selectedTemplate,
      selectedFilters,
      otherFlags,
    });
  };

  const handleMathChange = (val: 'mathjax' | 'katex' | 'webtex' | 'none') => {
    setMath(val);
    syncToRawText({
      standalone,
      citeproc,
      toc,
      numberSections,
      embedResources,
      math: val,
      template: selectedTemplate,
      selectedFilters,
      otherFlags,
    });
  };

  const handleTemplateChange = (val: string) => {
    setSelectedTemplate(val);
    syncToRawText({
      standalone,
      citeproc,
      toc,
      numberSections,
      embedResources,
      math,
      template: val,
      selectedFilters,
      otherFlags,
    });
  };

  const handleFilterToggle = (filterName: string) => {
    const nextFilters = selectedFilters.includes(filterName)
      ? selectedFilters.filter((f) => f !== filterName)
      : [...selectedFilters, filterName];
    setSelectedFilters(nextFilters);
    syncToRawText({
      standalone,
      citeproc,
      toc,
      numberSections,
      embedResources,
      math,
      template: selectedTemplate,
      selectedFilters: nextFilters,
      otherFlags,
    });
  };

  // Handler for Raw arguments text modification
  const handleRawTextChange = (text: string) => {
    setRawArgsText(text);
    const parts = text.split(/\s+/).filter(Boolean);
    const cmd = parts[0] || 'pandoc';
    const args = parts.slice(1);
    syncFromArgsArray(cmd, args, templatesDir, filtersDir);
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
                    checked={standalone}
                    label="Standalone"
                    onChange={handleStandaloneChange}
                  />
                  <Checkbox
                    checked={citeproc}
                    label="Citeproc"
                    onChange={handleCiteprocChange}
                  />
                  <Checkbox
                    checked={toc}
                    label="Table of Contents"
                    onChange={handleTocChange}
                  />
                  <Checkbox
                    checked={numberSections}
                    label="Number Sections"
                    onChange={handleNumberSectionsChange}
                  />
                  <Checkbox
                    checked={embedResources}
                    label="Embed Resources"
                    onChange={handleEmbedResourcesChange}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-[#8a92a3]">
                    MATH RENDERER ENGINE
                  </label>
                  <select
                    className="w-full rounded border border-[#2b2f38] bg-[#15171d] px-3 py-1.5 text-sm text-[#e6e8eb] outline-none focus:border-[#6aa8ff]"
                    value={math}
                    onChange={(e) => handleMathChange(e.target.value as any)}
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
                    value={selectedTemplate}
                    onChange={(e) => handleTemplateChange(e.target.value)}
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
                          checked={selectedFilters.includes(filt)}
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
