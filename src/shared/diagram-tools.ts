/**
 * Canonical registry of supported desktop diagram/drawing tools.
 *
 * This is the ONE place that defines a tool. Adding a tool means adding a
 * single record here. Server and client both derive all behaviour from this
 * array — no parallel if/else chains, no duplicated extension maps, no
 * per-tool special-casing anywhere else.
 *
 * Field semantics:
 *   id          - stable identifier used in API requests and state
 *   executables - probed in order at startup; first found wins as the spawn cmd
 *   ext         - file extension written by this tool (includes leading dot)
 *   starterTemplate - exact content written to a newly created figure file
 *   markdownRef - how a figure created by this tool is cited in the document
 *   label       - short display name shown in the UI
 *   desc        - one-line description shown under the label
 *   url         - official homepage / install page shown when tool is absent
 */
export interface DiagramTool {
  id: string;
  executables: string[];
  ext: string;
  starterTemplate: string;
  markdownRef: (filename: string) => string;
  label: string;
  desc: string;
  url: string;
}

export const DIAGRAM_TOOLS: DiagramTool[] = [
  {
    id: 'qtikz',
    executables: ['qtikz'],
    ext: '.tikz',
    starterTemplate: [
      '\\begin{tikzpicture}',
      '  \\draw (0,0) circle (1in);',
      '\\end{tikzpicture}',
    ].join('\n') + '\n',
    markdownRef: (filename) => `\\input{./figures/${filename}}`,
    label: 'Qtikz (TikZ editor)',
    desc: 'Writes .tikz files',
    url: 'https://github.com/nlohmann/qtikz',
  },
  {
    id: 'tikzit',
    executables: ['tikzit'],
    ext: '.tikz',
    starterTemplate: [
      '\\begin{tikzpicture}',
      '  \\draw (0,0) circle (1in);',
      '\\end{tikzpicture}',
    ].join('\n') + '\n',
    markdownRef: (filename) => `\\input{./figures/${filename}}`,
    label: 'Tikzit (Node/TikZ)',
    desc: 'Writes .tikz files',
    url: 'https://tikzit.github.io/',
  },
  {
    id: 'inkscape',
    executables: ['inkscape'],
    ext: '.svg',
    starterTemplate: [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">',
      '  <circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" />',
      '</svg>',
    ].join('\n') + '\n',
    markdownRef: (filename) => `![](./figures/${filename})`,
    label: 'Inkscape (Vector)',
    desc: 'Writes .svg drawings',
    url: 'https://inkscape.org/',
  },
  {
    id: 'xournal',
    // xournalpp is the modern fork; fall back to the legacy binary name
    executables: ['xournalpp', 'xournal'],
    ext: '.xopp',
    starterTemplate: [
      '<?xml version="1.0" standalone="no"?>',
      '<xournal version="0.4.8.2016">',
      '<title>Xournal Document</title>',
      '<page width="612.00000000" height="792.00000000">',
      '<background type="solid" color="#ffffffff" style="plain"/>',
      '<layer/>',
      '</page>',
      '</xournal>',
    ].join('\n') + '\n',
    markdownRef: (filename) => `![](./figures/${filename})`,
    label: 'Xournal++ (Sketch)',
    desc: 'Writes .xopp notes',
    url: 'https://github.com/xournalpp/xournalpp',
  },
  {
    id: 'ipe',
    executables: ['ipe'],
    ext: '.ipe',
    starterTemplate: [
      '<?xml version="1.0"?>',
      '<!DOCTYPE ipe SYSTEM "ipe.dtd">',
      '<ipe version="70218" creator="Ipe 7.2">',
      '<page>',
      '<layer name="alpha"/>',
      '<view layers="alpha" active="alpha"/>',
      '</page>',
      '</ipe>',
    ].join('\n') + '\n',
    markdownRef: (filename) => `![](./figures/${filename})`,
    label: 'Ipe (Extensible Editor)',
    desc: 'Writes .ipe drawings',
    url: 'https://ipe.otfried.org/',
  },
];

/** Look up a tool by id. Throws if not found — callers must use valid IDs. */
export function getDiagramTool(id: string): DiagramTool {
  const tool = DIAGRAM_TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown diagram tool id: ${id}`);
  return tool;
}

/** Look up a tool by file extension. Returns undefined if no tool owns that ext. */
export function getDiagramToolByExt(ext: string): DiagramTool | undefined {
  return DIAGRAM_TOOLS.find((t) => t.ext === ext.toLowerCase());
}
