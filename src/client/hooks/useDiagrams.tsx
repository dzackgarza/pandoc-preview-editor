import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { blobToBase64 } from '../lib/utils.js';
import { toast } from '../lib/toast.js';

export function useDiagrams(
  ensureRealFile: (options: { promptForEmpty: boolean; title?: string; description?: string }) => Promise<string | null>,
  insertTextAtCursor: (text: string) => void,
) {
  const [diagramOpen, setDiagramOpen] = useState(false);

  const uploadImageAndInsert = useCallback(
    async (imageBlob: Blob, filePath: string) => {
      const imageType = imageBlob.type || 'image/png';
      try {
        const data = await invoke<{
          ok: boolean;
          markdown: string;
          path: string;
        }>('save_figure_asset', {
          documentPath: filePath,
          mimeType: imageType,
          contentBase64: await blobToBase64(imageBlob),
        });

        if (!data.ok || typeof data.markdown !== 'string') {
          throw new Error('Failed to save figure asset');
        }
        insertTextAtCursor(`\n\n${data.markdown}\n\n`);
        toast({
          title: 'Clipboard image',
          description: data.markdown,
          variant: 'default',
        });
      } catch (err) {
        toast({
          title: 'Figure save failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      }
    },
    [insertTextAtCursor],
  );

  const insertClipboardFigure = useCallback(async () => {
    try {
      const filePath = await ensureRealFile({
        promptForEmpty: true,
        title: 'Save Markdown Document',
        description:
          'Save your active document to disk first. Adding figure/diagram assets requires a saved file context to resolve relative asset paths correctly.',
      });
      if (filePath == null) return;
      if (!navigator.clipboard?.read) {
        throw new Error('clipboard image read is not available');
      }

      const items = await navigator.clipboard.read();
      let imageBlob: Blob | null = null;
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith('image/'));
        if (type) {
          imageBlob = await item.getType(type);
          break;
        }
      }
      if (!imageBlob) {
        throw new Error('clipboard does not contain an image');
      }

      await uploadImageAndInsert(imageBlob, filePath);
    } catch (err) {
      toast({
        title: 'Clipboard image',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [ensureRealFile, uploadImageAndInsert]);

  return {
    diagramOpen,
    setDiagramOpen,
    insertClipboardFigure,
    uploadImageAndInsert,
  };
}
