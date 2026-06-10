import { useCallback, useRef, useState } from 'react';
import { useGroupRef } from 'react-resizable-panels';
import { EditorView } from '@codemirror/view';

export const RESET_LAYOUT = {
  'editor-pane-panel': 56,
  'preview-pane-panel': 44,
};

export function useAppLayout() {
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'figures'>('explorer');
  const groupRef = useGroupRef();
  const editorViewRef = useRef<EditorView | null>(null);

  const resetSplit = useCallback(() => {
    groupRef.current?.setLayout(RESET_LAYOUT);
  }, [groupRef]);

  const toggleExplorer = useCallback(() => {
    setExplorerOpen((open) => !open);
  }, []);

  const openExplorerTab = useCallback((tab: 'explorer' | 'figures') => {
    setSidebarTab(tab);
    setExplorerOpen(true);
  }, []);

  return {
    explorerOpen,
    sidebarTab,
    groupRef,
    editorViewRef,
    setExplorerOpen,
    resetSplit,
    toggleExplorer,
    openExplorerTab,
    RESET_LAYOUT,
  };
}
