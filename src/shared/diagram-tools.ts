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
  markdownRef: (absolutePath: string) => string;
  label: string;
  desc: string;
  url: string;
}

const MARKDOWN_REFS: Record<string, (absolutePath: string) => string> = {
  qtikz: (absolutePath) => `\\input{${absolutePath}}`,
  tikzit: (absolutePath) => `\\input{${absolutePath}}`,
  inkscape: (absolutePath) => `![](${absolutePath})`,
  xournalpp: (absolutePath) => `![](${absolutePath})`,
  ipe: (absolutePath) => `![](${absolutePath})`,
};

export const DIAGRAM_TOOLS: DiagramTool[] = toolData.map((t) => ({
  ...t,
  markdownRef: MARKDOWN_REFS[t.id] ?? ((absolutePath: string) => `![](${absolutePath})`),
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
