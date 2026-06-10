import { quote } from 'shell-quote';

// ─── Rust-side parsed flags (from get_config().parsedFlags) ─────────────────

export interface RustParsedFlags {
  command_name: string;
  standalone: boolean;
  citeproc: boolean;
  toc: boolean;
  number_sections: boolean;
  embed_resources: boolean;
  math_engine: 'None' | 'MathJax' | 'KaTeX' | 'WebTeX';
  template: string | null;
  filters: Array<{ flag: string; path: string }>;
  other_args: string[];
}

// ─── Settings-UI-friendly form (bare filenames for dropdowns) ─────────────────

export interface ParsedFlags {
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

const MATH_MAP: Record<RustParsedFlags['math_engine'], ParsedFlags['math']> = {
  None: 'none',
  MathJax: 'mathjax',
  KaTeX: 'katex',
  WebTeX: 'webtex',
};

/// Convert Rust-side parsed flags into the Settings-UI-friendly form
/// where template/filter values are bare filenames (not full paths).
export function fromRustParsedFlags(rust: RustParsedFlags): ParsedFlags {
  const selectedTemplate = rust.template
    ? rust.template.startsWith('/') || rust.template.startsWith('~/')
      ? rust.template
      : rust.template.split('/').at(-1) || rust.template
    : '';

  const selectedFilters = rust.filters.map((f) => {
    if (f.path.startsWith('/') || f.path.startsWith('~/')) return f.path;
    return f.path.split('/').at(-1) || f.path;
  });

  return {
    commandName: rust.command_name,
    standalone: rust.standalone,
    citeproc: rust.citeproc,
    toc: rust.toc,
    numberSections: rust.number_sections,
    embedResources: rust.embed_resources,
    math: MATH_MAP[rust.math_engine] ?? 'none',
    selectedTemplate,
    selectedFilters,
    otherFlags: rust.other_args,
  };
}

// ─── Command reconstruction ──────────────────────────────────────────────────

export function buildCommand(
  flags: ParsedFlags,
  templatesDir: string,
  filtersDir: string,
): string {
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
    if (
      flags.selectedTemplate.startsWith('/') ||
      flags.selectedTemplate.startsWith('~/')
    ) {
      args.push(`--template=${flags.selectedTemplate}`);
    } else {
      args.push(
        `--template=${templatesDir.replace(/\/$/, '')}/${flags.selectedTemplate}`,
      );
    }
  }
  for (const filter of flags.selectedFilters) {
    const ext = filter.endsWith('.lua') ? '--lua-filter' : '--filter';
    if (filter.startsWith('/') || filter.startsWith('~/')) {
      args.push(`${ext}=${filter}`);
    } else {
      args.push(`${ext}=${filtersDir.replace(/\/$/, '')}/${filter}`);
    }
  }
  args.push(...flags.otherFlags);
  return quote([flags.commandName, ...args]);
}
