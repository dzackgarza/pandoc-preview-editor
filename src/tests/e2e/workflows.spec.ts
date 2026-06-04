import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures.js';
import {
  getPandocFilters,
  invokeTauri,
  parseToml,
  previewText,
  replaceEditorContents,
  saveViaFileSelector,
} from './editor-helpers.js';

function pandocHtmlOracle(file: string, output: string) {
  execFileSync(
    'pandoc',
    [
      file,
      '-f',
      'markdown+tex_math_dollars+citations',
      '-t',
      'html',
      '--standalone',
      '--mathjax',
      '-o',
      output,
    ],
    { stdio: 'pipe' },
  );
}

const documentWorkflow = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const nestedDir = path.join(testEnv.workspaceDir, 'nested');
    const ignoredDir = path.join(testEnv.workspaceDir, 'node_modules');
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(ignoredDir, { recursive: true });

    const documentPath = path.join(testEnv.workspaceDir, 'proof.md');
    writeFileSync(documentPath, '# Proof file\n\nOriginal proof content.\n', 'utf8');
    writeFileSync(
      path.join(nestedDir, 'chapter.md'),
      '# Chapter\n\nInitial chapter.\n',
      'utf8',
    );
    writeFileSync(path.join(testEnv.workspaceDir, '.hidden.md'), 'hidden', 'utf8');
    writeFileSync(path.join(ignoredDir, 'ignored.md'), 'ignored', 'utf8');
    writeFileSync(path.join(testEnv.workspaceDir, 'image.bin'), Buffer.from([1, 2]));
    testEnv.writeSessionState(documentPath, false);

    await use(testEnv);
  },
});

const renderingWorkflow = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
    const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');
    mkdirSync(templatesDir, { recursive: true });
    mkdirSync(filtersDir, { recursive: true });
    writeFileSync(path.join(templatesDir, 'custom.html'), '<html>$body$</html>');
    writeFileSync(path.join(filtersDir, 'my-filter.lua'), '-- Lua filter');
    writeFileSync(path.join(filtersDir, 'another.lua'), '-- Another filter');

    const documentPath = path.join(testEnv.workspaceDir, 'render.md');
    writeFileSync(documentPath, '# Document\n\nInitial render text.\n', 'utf8');
    testEnv.writeConfig({
      renderCommand: 'pandoc -f markdown -t html --standalone --citeproc --mathjax',
      templatesDir,
      filtersDir,
    });
    testEnv.writeSessionState(documentPath, false);

    await use(testEnv);
  },
});

const actionWorkflow = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const documentPath = path.join(testEnv.workspaceDir, 'source.md');
    writeFileSync(documentPath, '# Plugin Source\n\nInitial.\n', 'utf8');
    testEnv.writeSessionState(documentPath, false);

    await use(testEnv);
  },
});

const recoveryWorkflow = test.extend({
  testEnv: async ({ testEnv }, use) => {
    const documentPath = path.join(testEnv.workspaceDir, 'recovery.md');
    writeFileSync(documentPath, '# Recovery\n\nOriginal.\n', 'utf8');
    testEnv.writeConfig({ restoreLastFile: true });
    testEnv.writeSessionState(documentPath, false);

    await use(testEnv);
  },
});

test.describe('canonical desktop workflows', () => {
  documentWorkflow(
    'document editing, file identity, explorer navigation, save, and save-as run in one desktop session',
    async ({ appPage, testEnv }) => {
      const documentPath = path.join(testEnv.workspaceDir, 'proof.md');
      const chapterPath = path.join(testEnv.workspaceDir, 'nested', 'chapter.md');
      const saveAsPath = path.join(testEnv.workspaceDir, 'nested', 'saved-as.md');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        documentPath,
      );
      await expect.poll(() => previewText(appPage)).toContain('Original proof content');

      await replaceEditorContents(appPage, '# Proof file\n\nEdited content.\n');
      await expect(appPage.locator('#save-state')).toContainText('unsaved');
      await appPage.locator('button[aria-label="Save"]').click();
      await expect(appPage.locator('#save-state')).toContainText('saved');
      expect(readFileSync(documentPath, 'utf8')).toBe(
        '# Proof file\n\nEdited content.\n',
      );

      await appPage.locator('button[aria-label="File Explorer"]').click();
      const explorer = appPage.getByTestId('explorer-drawer');
      await expect(explorer).toBeVisible();
      await expect(explorer).toContainText('proof.md');
      await expect(explorer).toContainText('nested');
      await expect(explorer).not.toContainText('.hidden.md');
      await expect(explorer).not.toContainText('node_modules');
      await expect(explorer).not.toContainText('image.bin');

      await explorer.locator('button').filter({ hasText: /nested/ }).click();
      await explorer.locator('button').filter({ hasText: /chapter\.md/ }).click();
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        chapterPath,
      );
      await expect.poll(() => previewText(appPage)).toContain('Initial chapter');

      await replaceEditorContents(appPage, '# Saved As\n\nInside workspace.\n');
      await appPage.keyboard.press('Control+Shift+S');
      await saveViaFileSelector(appPage, saveAsPath);
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        saveAsPath,
      );
      expect(readFileSync(saveAsPath, 'utf8')).toBe(
        '# Saved As\n\nInside workspace.\n',
      );
    },
  );

  renderingWorkflow(
    'configuration, pandoc asset discovery, command parsing, settings persistence, and preview rendering run in one desktop session',
    async ({ appPage, testEnv }) => {
      const templatesDir = path.join(testEnv.homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(testEnv.homeDir, '.pandoc', 'filters');
      const filterPath = path.join(filtersDir, 'my-filter.lua');
      const templatePath = path.join(templatesDir, 'custom.html');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect.poll(() => previewText(appPage)).toContain('Initial render text');

      const assets = await invokeTauri(appPage, 'pandoc_assets', {});
      expect(getPandocFilters(assets)).toEqual(['another.lua', 'my-filter.lua']);

      const initialConfig = (await invokeTauri(appPage, 'get_config', {})) as Record<
        string,
        unknown
      >;
      expect(initialConfig.renderCommand).toContain('--citeproc');

      await invokeTauri(appPage, 'set_config', {
        templatesDir,
        filtersDir,
        debounceMs: 100,
        timeoutMs: 30000,
        renderCommand: `pandoc --standalone --template=${templatePath} --lua-filter=${filterPath} -t html5`,
        restoreLastFile: true,
      });

      const updatedConfig = (await invokeTauri(appPage, 'get_config', {})) as Record<
        string,
        unknown
      >;
      const parsedFlags = updatedConfig.parsedFlags as Record<string, unknown>;
      expect(parsedFlags.template).toBe(templatePath);
      expect(parsedFlags.filters).toEqual([
        { flag: 'lua-filter', path: filterPath },
      ]);

      const savedToml = parseToml(readFileSync(testEnv.configPath, 'utf8'));
      expect(savedToml.pandoc.render_command).toContain(templatePath);
      expect(savedToml.pandoc.render_command).toContain(filterPath);

      await replaceEditorContents(appPage, '# Re-rendered\n\nConfigured render path.');
      await expect.poll(() => previewText(appPage), { timeout: 10000 }).toContain(
        'Re-rendered',
      );
    },
  );

  actionWorkflow(
    'plugin export, save-gated plugin rejection, and diagram file creation run in one desktop session',
    async ({ appPage, testEnv }) => {
      const documentPath = path.join(testEnv.workspaceDir, 'source.md');
      const htmlPath = path.join(testEnv.workspaceDir, 'source.html');
      const expectedHtml = path.join(testEnv.workspaceDir, 'expected.html');

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      const plugins = (await invokeTauri(appPage, 'list_plugins', {})) as {
        plugins: Array<Record<string, unknown>>;
      };
      expect(plugins.plugins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'export-html', name: 'Export to HTML' }),
          expect.objectContaining({ id: 'export-latex', name: 'Export to LaTeX' }),
          expect.objectContaining({ id: 'export-pdf', name: 'Export to PDF' }),
        ]),
      );
      expect(plugins.plugins.find((plugin) => plugin.id === 'export-html')).not.toHaveProperty(
        'command',
      );

      try {
        await invokeTauri(appPage, 'run_plugin', {
          id: 'export-html',
          markdown: '# Unsaved\n\nNo path.',
        });
        throw new Error('run_plugin unexpectedly accepted an unsaved buffer');
      } catch (error) {
        expect(String(error)).toContain('save the document first');
      }

      const exportResult = (await invokeTauri(appPage, 'run_plugin', {
        id: 'export-html',
        path: documentPath,
        markdown: '# Plugin Source\n\nInitial.\n',
      })) as { ok: boolean; exitCode: number; outputPath: string };
      expect(exportResult).toEqual({ ok: true, exitCode: 0, outputPath: htmlPath });
      pandocHtmlOracle(documentPath, expectedHtml);
      expect(readFileSync(htmlPath, 'utf8')).toBe(readFileSync(expectedHtml, 'utf8'));

      const diagramResult = (await invokeTauri(appPage, 'create_diagram_file', {
        kind: 'qtikz',
        filename: 'diagram.tikz',
        documentPath,
      })) as { ok: boolean; relativePath: string; absolutePath: string };
      expect(diagramResult.ok).toBe(true);
      expect(diagramResult.relativePath).toBe('figures/diagram.tikz');
      expect(readFileSync(diagramResult.absolutePath, 'utf8')).toContain(
        '\\begin{tikzpicture}',
      );
    },
  );

  recoveryWorkflow(
    'backup recovery and renderer diagnostics run in one desktop session',
    async ({ appPage, testEnv }) => {
      const documentPath = path.join(testEnv.workspaceDir, 'recovery.md');
      const unsaved = '# Recovery\n\nUnsaved backup content.\n';

      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('footer span[title]')).toHaveAttribute(
        'title',
        documentPath,
      );

      await replaceEditorContents(appPage, unsaved);
      await expect(appPage.locator('#save-state')).toContainText('unsaved');
      await invokeTauri(appPage, 'backup', { markdown: unsaved, path: documentPath });
      await appPage.evaluate('window.location.reload()');
      await expect(appPage.getByTestId('editor')).toBeVisible({ timeout: 15000 });
      await expect(appPage.locator('.cm-content')).toContainText(
        'Unsaved backup content.',
      );

      await invokeTauri(appPage, 'set_config', {
        templatesDir: path.join(testEnv.homeDir, '.pandoc', 'templates'),
        filtersDir: path.join(testEnv.homeDir, '.pandoc', 'filters'),
        debounceMs: 50,
        timeoutMs: 30000,
        renderCommand: 'zsh -c "echo renderer exploded >&2; exit 42"',
        restoreLastFile: true,
      });
      await replaceEditorContents(appPage, '# Broken render\n\nShould fail visibly.');
      await expect(appPage.locator('#status')).toContainText('render failed', {
        timeout: 10000,
      });
      await expect(appPage.locator('#diagnostics')).toContainText('renderer exploded');
    },
  );
});
