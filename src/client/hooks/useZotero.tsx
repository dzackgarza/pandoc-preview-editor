import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from '../lib/toast.js';

export function useZotero(insertTextAtCursor: (text: string) => void) {
  const insertCitation = useCallback(async () => {
    try {
      const data = await invoke<{ citation?: string; empty?: boolean }>('zotero_cite');
      if (data.empty) return;

      if (typeof data.citation !== 'string') {
        throw new Error('no citation returned');
      }

      insertTextAtCursor(data.citation);
      toast({
        title: 'Zotero citation',
        description: data.citation,
        variant: 'default',
      });
    } catch (err) {
      toast({
        title: 'Zotero citation',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [insertTextAtCursor]);

  return { insertCitation };
}
