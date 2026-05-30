/**
 * Canonical registry of supported desktop diagram/drawing tools.
 *
 * This file re-exports the data from diagram-tools.json. Adding a tool
 * means adding one record to the JSON file — no parallel registries,
 * no duplicated extension maps, no per-tool special-casing.
 */
import toolData from './diagram-tools.json' with { type: 'json' };

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

const MARKDOWN_REFS: Record<string, (filename: string) => string> = {
  qtikz: (f) => `\\input{./figures/${f}}`,
  tikzit: (f) => `\\input{./figures/${f}}`,
  inkscape: (f) => `![](./figures/${f})`,
  drawio: (f) => `![](./figures/${f})`,
  xournal: (f) => `![](./figures/${f})`,
  xournalpp: (f) => `![](./figures/${f})`,
  ipe: (f) => `![](./figures/${f})`,
};

export const DIAGRAM_TOOLS: DiagramTool[] = toolData.map((t) => ({
  ...t,
  markdownRef: MARKDOWN_REFS[t.id] ?? ((f: string) => `![](./figures/${f})`),
}));

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
