import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from '../lib/toast.js';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export type OpenFileResult = {
  path: string;
  absolutePath: string;
  content: string;
};

export function useFileManager() {
  const [markdownText, setMarkdownText] = useState('');
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [isTempFile, setIsTempFile] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Dialog states
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [saveAsDialogMode, setSaveAsDialogMode] = useState<'save' | 'new'>('save');
  const [saveAsDialogTitleOverride, setSaveAsDialogTitleOverride] = useState<string | undefined>(undefined);
  const [saveAsDialogDescription, setSaveAsDialogDescription] = useState<string | undefined>(undefined);
  const [unsavedChangesDialogOpen, setUnsavedChangesDialogOpen] = useState(false);

  const saveAsResolveRef = useRef<((path: string | null) => void) | null>(null);
  const unsavedChangesResolveRef = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null);

  const updateMarkdown = useCallback((value: string) => {
    setMarkdownText(value);
    setSaveState('dirty');
    setSavedAt(null);
  }, []);

  const promptForSavePath = useCallback(
    (mode: 'save' | 'new', titleOverride?: string, description?: string): Promise<string | null> => {
      return new Promise((resolve) => {
        saveAsResolveRef.current = resolve;
        setSaveAsDialogMode(mode);
        setSaveAsDialogTitleOverride(titleOverride);
        setSaveAsDialogDescription(description);
        setSaveAsDialogOpen(true);
      });
    },
    [],
  );

  const handleSaveAsSubmit = useCallback((path: string) => {
    setSaveAsDialogOpen(false);
    setSaveAsDialogTitleOverride(undefined);
    setSaveAsDialogDescription(undefined);
    saveAsResolveRef.current?.(path);
  }, []);

  const handleSaveAsCancel = useCallback(() => {
    setSaveAsDialogOpen(false);
    setSaveAsDialogTitleOverride(undefined);
    setSaveAsDialogDescription(undefined);
    saveAsResolveRef.current?.(null);
  }, []);

  const promptForUnsavedChanges = useCallback((): Promise<'save' | 'discard' | 'cancel'> => {
    return new Promise((resolve) => {
      unsavedChangesResolveRef.current = resolve;
      setUnsavedChangesDialogOpen(true);
    });
  }, []);

  const handleUnsavedChangesSave = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    unsavedChangesResolveRef.current?.('save');
  }, []);

  const handleUnsavedChangesDiscard = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    unsavedChangesResolveRef.current?.('discard');
  }, []);

  const handleUnsavedChangesCancel = useCallback(() => {
    setUnsavedChangesDialogOpen(false);
    unsavedChangesResolveRef.current?.('cancel');
  }, []);

  const persistMarkdown = useCallback(
    async (path: string, text: string) => {
      setSaveState('saving');
      try {
        const data = await invoke<{
          ok: boolean;
          path: string;
          workspaceRoot: string;
        }>('save', { markdown: text, path });

        if (!data.ok) {
          throw new Error('save failed');
        }

        const savedPath = data.path ?? path;
        setCurrentFile(savedPath);
        setWorkspaceRoot(data.workspaceRoot);
        setIsTempFile(false);
        setSaveState('saved');
        setSavedAt(new Date());
        return savedPath;
      } catch (err) {
        setSaveState('error');
        const message = err instanceof Error ? err.message : String(err);
        toast({
          title: 'Save failed',
          description: message,
          variant: 'destructive',
        });
        return null;
      }
    },
    [],
  );

  const ensureRealFile = useCallback(
    async (options: { promptForEmpty: boolean; title?: string; description?: string }) => {
      if (isTempFile || !currentFile) {
        if (!options.promptForEmpty && markdownText.length === 0 && saveState !== 'dirty') {
          return null;
        }
        const savePath = await promptForSavePath('save', options.title, options.description);
        if (savePath === null) return null;
        return persistMarkdown(savePath, markdownText);
      }

      if (saveState === 'dirty') {
        return persistMarkdown(currentFile, markdownText);
      }
      return currentFile;
    },
    [currentFile, isTempFile, markdownText, persistMarkdown, promptForSavePath, saveState],
  );

  const ensureBufferSafeToReplace = useCallback(async () => {
    if ((isTempFile || !currentFile) && markdownText.length === 0 && saveState !== 'dirty') {
      return true;
    }
    if (saveState !== 'dirty') {
      return true;
    }
    const choice = await promptForUnsavedChanges();
    if (choice === 'cancel') {
      return false;
    }
    if (choice === 'save') {
      return (await ensureRealFile({ promptForEmpty: true })) != null;
    }
    return true; // discard
  }, [currentFile, ensureRealFile, isTempFile, markdownText, promptForUnsavedChanges, saveState]);

  const saveCurrent = useCallback(async () => {
    return ensureRealFile({ promptForEmpty: true });
  }, [ensureRealFile]);

  const saveCurrentAs = useCallback(async () => {
    const savePath = await promptForSavePath('save');
    if (savePath === null) return;
    await persistMarkdown(savePath, markdownText);
  }, [markdownText, persistMarkdown, promptForSavePath]);

  const createNewFile = useCallback(async () => {
    if (!(await ensureBufferSafeToReplace())) return;

    const savePath = await promptForSavePath('new');
    if (savePath === null) return;

    setSaveState('saving');
    try {
      const data = await invoke<{
        ok: boolean;
        path: string;
        absolutePath: string;
        content: string;
        workspaceRoot: string;
      }>('new_file', { path: savePath });

      if (!data.ok || typeof data.absolutePath !== 'string') {
        throw new Error('Failed to create file');
      }

      setMarkdownText(data.content);
      setCurrentFile(data.absolutePath);
      setWorkspaceRoot(data.workspaceRoot);
      setIsTempFile(false);
      setSaveState('dirty');
      setSavedAt(null);
    } catch (err) {
      setSaveState('error');
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Create file failed',
        description: message,
        variant: 'destructive',
      });
    }
  }, [ensureBufferSafeToReplace, promptForSavePath]);

  const openFile = useCallback(
    async (result: OpenFileResult) => {
      if (!(await ensureBufferSafeToReplace())) return false;
      setMarkdownText(result.content);
      setCurrentFile(result.absolutePath);
      setIsTempFile(false);
      setSaveState('idle');
      setSavedAt(null);
      return true;
    },
    [ensureBufferSafeToReplace],
  );

  const handleQuickOpen = useCallback(async () => {
    try {
      const data = await invoke<{
        ok: boolean;
        cancelled?: boolean;
        path: string;
        absolutePath: string;
        content: string;
        error?: string;
      }>('quick_open_spawn');
      if (data.ok) {
        await openFile({
          path: data.path,
          absolutePath: data.absolutePath,
          content: data.content,
        });
      } else if (data.error) {
        toast({
          title: 'Quick Open Error',
          description: data.error,
          variant: 'destructive',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Quick Open Failed',
        description: msg,
        variant: 'destructive',
      });
    }
  }, [openFile]);

  return {
    markdownText,
    currentFile,
    isTempFile,
    workspaceRoot,
    saveState,
    savedAt,
    saveAsDialogOpen,
    saveAsDialogMode,
    saveAsDialogTitleOverride,
    saveAsDialogDescription,
    unsavedChangesDialogOpen,
    setMarkdownText,
    setCurrentFile,
    setIsTempFile,
    setWorkspaceRoot,
    setSaveState,
    setSavedAt,
    updateMarkdown,
    saveCurrent,
    saveCurrentAs,
    createNewFile,
    openFile,
    handleQuickOpen,
    ensureRealFile,
    handleSaveAsSubmit,
    handleSaveAsCancel,
    handleUnsavedChangesSave,
    handleUnsavedChangesDiscard,
    handleUnsavedChangesCancel,
  };
}
