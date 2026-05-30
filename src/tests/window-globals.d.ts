declare global {
  interface Window {
    __INITIAL_CONTENT?: string;
    __INITIAL_FILE?: string | null;
    __TEMP_BACKUP_FILE?: string | null;
    __WORKSPACE_ROOT?: string;
    __IS_TEMP_FILE?: boolean;
    __RECOVERED_FROM_BACKUP?: boolean;
    __PANDOC_PREVIEW_STATE__?: {
      markdown: string;
      currentFile: string | null;
    };
  }
}

export {};
