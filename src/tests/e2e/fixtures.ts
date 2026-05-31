// @ts-nocheck — tauri-playwright 0.2.2 types reference unexported PageLike

import { createTauriTest } from '@srsholmes/tauri-playwright';

export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    get_initial_state: () => ({
      content: '',
      file: null,
      tempBackupFile: null,
      workspaceRoot: '/tmp/test-workspace',
      isTempFile: false,
      recoveredFromBackup: false,
    }),
    get_config: () => ({
      templatesDir: '/tmp/test-home/.pandoc/templates',
      filtersDir: '/tmp/test-home/.pandoc/filters',
      debounceMs: 250,
      timeoutMs: 30000,
      renderCommand: 'pandoc --standalone -t html5',
      restoreLastFile: false,
      parsedFlags: {
        command_name: 'pandoc',
        standalone: true,
        citeproc: false,
        toc: false,
        number_sections: false,
        embed_resources: false,
        math_engine: 'None',
        template: null,
        filters: [],
        other_args: ['-t', 'html5'],
      },
    }),
    pandoc_assets: () => ({
      templates: [],
      filters: [],
    }),
    list_plugins: () => ({
      plugins: [],
    }),
  },
});
