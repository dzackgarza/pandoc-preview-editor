import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from '../lib/toast.js';

export type PluginState = 'idle' | 'running' | 'complete' | 'error';

export type PluginMetadata = {
  id: string;
  name: string;
  description: string;
  category: string;
};

export function usePlugins(
  markdownText: string,
  ensureRealFile: (options: { title?: string; description?: string; promptForEmpty: boolean }) => Promise<string | null>,
  setSaveState: (state: any) => void,
  setSavedAt: (date: Date | null) => void,
) {
  const [pluginState, setPluginState] = useState<PluginState>('idle');
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);

  const loadPlugins = useCallback(() => {
    invoke<{ plugins: PluginMetadata[] }>('list_plugins')
      .then((data) => {
        setPlugins(data.plugins);
      })
      .catch((err) => {
        console.error('Failed to load plugins:', err);
      });
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  const runPluginAction = useCallback(
    async (pluginId: string) => {
      const pluginMeta = plugins.find((p) => p.id === pluginId);
      const pluginName = pluginMeta?.name ?? pluginId;
      const filePath = await ensureRealFile({
        promptForEmpty: true,
        title: 'Save Original Markdown Document',
        description: `Please choose a location to save your original Markdown document first. The plugin "${pluginName}" requires a saved file context on disk to run.`,
      });
      if (filePath == null) return;
      setPluginState('running');
      setSaveState('saving');

      try {
        const data = await invoke<{
          ok: boolean;
          stdout: string;
          stderr: string;
          exitCode: number | null;
          outputPath?: string;
        }>('run_plugin', {
          id: pluginId,
          markdown: markdownText,
          path: filePath,
        });

        if (!data.ok) {
          throw new Error(data.stderr || 'plugin execution failed');
        }

        setSaveState('saved');
        setSavedAt(new Date());
        setPluginState('idle');

        const handleOpen = async () => {
          try {
            await invoke('open_file_external', { path: data.outputPath });
          } catch (err) {
            console.error('Failed to open file:', err);
          }
        };

        toast({
          title: pluginMeta?.name ?? pluginId,
          description: data.outputPath ? (
            <span>
              completed successfully. Output:{' '}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  void handleOpen();
                }}
                className="underline text-[#8fb8ff] hover:text-[#b4d2ff] font-medium transition-colors focus-visible:outline-none"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                {data.outputPath.split('/').at(-1)}
              </button>
            </span>
          ) : data.stderr ? (
            `stderr: ${data.stderr}`
          ) : (
            'completed successfully'
          ),
          variant: 'default',
        });
      } catch (err) {
        setSaveState('error');
        setPluginState('idle');

        const message = err instanceof Error ? err.message : String(err);
        toast({
          title: pluginMeta?.name ?? pluginId,
          description: message,
          variant: 'destructive',
        });
      }
    },
    [ensureRealFile, markdownText, plugins, setSaveState, setSavedAt],
  );

  return {
    pluginState,
    plugins,
    runPluginAction,
  };
}
