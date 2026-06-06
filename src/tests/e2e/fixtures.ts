import { createTauriTest, tauriExpect } from '@srsholmes/tauri-playwright';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const devUrl = 'http://localhost:5173';
const mcpSocket = path.join(repoRoot, '.agents', 'tmp', 'tauri-playwright.sock');
mkdirSync(path.dirname(mcpSocket), { recursive: true });

export const PANDOC_TEMPLATE_NAME = 'pandoc_preview_template.html';
export const PANDOC_TEMPLATE_CONTENT =
  '<!doctype html><html><head><meta charset="utf-8"></head><body>$body$</body></html>\n';
export const PANDOC_FILTER_FILES = [
  { name: 'tikzcd.lua', content: 'return {}\n' },
  { name: 'convert_amsthm_envs.lua', content: 'return {}\n' },
] as const;

const base = createTauriTest({
  devUrl,
  mcpSocket,
  tauriCommand: 'src/tests/e2e/run-tauri-dev.sh',
  tauriCwd: repoRoot,
  tauriFeatures: ['e2e-testing'],
  startTimeout: 180,
});

export type TestEnvironment = {
  rootDir: string;
  homeDir: string;
  workspaceDir: string;
  xdgConfigHome: string;
  xdgStateHome: string;
  configPath: string;
  sessionStatePath: string;
  templatesDir: string;
  filtersDir: string;
  figuresDir: string;
  writeConfig: (overrides?: {
    debounceMs?: number;
    timeoutMs?: number;
    restoreLastFile?: boolean;
    renderCommand?: string;
    templatesDir?: string;
    filtersDir?: string;
    figuresDir?: string;
  }) => void;
  writeSessionState: (filePath: string, isTempFile?: boolean) => void;
  readConfig: () => string;
};

type LaunchSetup = (env: TestEnvironment) => void | Promise<void>;

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function pandocDirs(
  env: Pick<TestEnvironment, 'homeDir'>,
  overrides: Parameters<TestEnvironment['writeConfig']>[0] = {},
) {
  return {
    templatesDir: overrides.templatesDir ?? path.join(env.homeDir, '.pandoc', 'templates'),
    filtersDir: overrides.filtersDir ?? path.join(env.homeDir, '.pandoc', 'filters'),
    figuresDir: overrides.figuresDir ?? path.join(env.homeDir, '.pandoc', 'figures'),
  };
}

function defaultRenderCommand(templatesDir: string, filtersDir: string) {
  return [
    'pandoc',
    '-f markdown+tex_math_dollars+citations',
    '--standalone',
    '--citeproc',
    '--mathjax',
    `--template=${path.join(templatesDir, PANDOC_TEMPLATE_NAME)}`,
    ...PANDOC_FILTER_FILES.map(({ name }) => `--lua-filter=${path.join(filtersDir, name)}`),
    '--to=html5',
  ].join(' ');
}

function assertFileContent(filePath: string, expectedContent: string) {
  const actualContent = readFileSync(filePath, 'utf-8');
  if (actualContent !== expectedContent) {
    throw new Error(`fixture file content mismatch: ${filePath}`);
  }
}

function writePandocAssets(templatesDir: string, filtersDir: string, figuresDir: string) {
  ensureDir(templatesDir);
  ensureDir(filtersDir);
  ensureDir(figuresDir);

  const templatePath = path.join(templatesDir, PANDOC_TEMPLATE_NAME);
  writeFileSync(templatePath, PANDOC_TEMPLATE_CONTENT, 'utf-8');
  assertFileContent(templatePath, PANDOC_TEMPLATE_CONTENT);

  for (const { name, content } of PANDOC_FILTER_FILES) {
    const filterPath = path.join(filtersDir, name);
    writeFileSync(filterPath, content, 'utf-8');
    assertFileContent(filterPath, content);
  }
}

function defaultConfig(
  env: Pick<TestEnvironment, 'homeDir'>,
  overrides: Parameters<TestEnvironment['writeConfig']>[0] = {},
) {
  const { templatesDir, filtersDir, figuresDir } = pandocDirs(env, overrides);

  return `[render]
debounce_ms = ${overrides.debounceMs ?? 50}
timeout_ms = ${overrides.timeoutMs ?? 30000}
restore_last_file = ${overrides.restoreLastFile ?? true}

[pandoc]
render_command = ${JSON.stringify(
    overrides.renderCommand ?? defaultRenderCommand(templatesDir, filtersDir),
  )}
templates_dir = ${JSON.stringify(templatesDir)}
filters_dir = ${JSON.stringify(filtersDir)}
figures_dir = ${JSON.stringify(figuresDir)}
`;
}

export const test = base.test.extend<{
  launchSetup: LaunchSetup;
  testEnv: TestEnvironment;
  appPage: import('@srsholmes/tauri-playwright').TauriPage;
}>({
  mode: async ({ mode, testEnv }, use) => {
    await use(mode);
  },
  launchSetup: [
    async ({}, use) => {
      await use(async () => {});
    },
    { option: true },
  ],
  testEnv: [
    async ({ launchSetup }, use) => {
      const rootDir = mkdtempSync(path.join(tmpdir(), 'pandoc-preview-e2e-'));
      const homeDir = path.join(rootDir, 'home');
      const workspaceDir = path.join(rootDir, 'workspace');
      const xdgConfigHome = path.join(rootDir, 'xdg-config');
      const xdgStateHome = path.join(rootDir, 'xdg-state');
      const configDir = path.join(xdgConfigHome, 'pandoc-preview');
      const stateDir = path.join(xdgStateHome, 'pandoc-preview');
      const configPath = path.join(configDir, 'config.toml');
      const sessionStatePath = path.join(stateDir, 'state.json');
      const templatesDir = path.join(homeDir, '.pandoc', 'templates');
      const filtersDir = path.join(homeDir, '.pandoc', 'filters');
      const figuresDir = path.join(homeDir, '.pandoc', 'figures');

      for (const dir of [
        homeDir,
        workspaceDir,
        configDir,
        stateDir,
        templatesDir,
        filtersDir,
        figuresDir,
      ]) {
        ensureDir(dir);
      }

      const previousEnv = {
        HOME: process.env.HOME,
        CARGO_HOME: process.env.CARGO_HOME,
        RUSTUP_HOME: process.env.RUSTUP_HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        XDG_STATE_HOME: process.env.XDG_STATE_HOME,
        PANDOC_PREVIEW_TEST_HOME: process.env.PANDOC_PREVIEW_TEST_HOME,
        PANDOC_PREVIEW_TEST_XDG_CONFIG_HOME:
          process.env.PANDOC_PREVIEW_TEST_XDG_CONFIG_HOME,
        PANDOC_PREVIEW_TEST_XDG_STATE_HOME:
          process.env.PANDOC_PREVIEW_TEST_XDG_STATE_HOME,
      };

      const writeConfig = (overrides = {}) => {
        const dirs = pandocDirs({ homeDir }, overrides);
        writePandocAssets(dirs.templatesDir, dirs.filtersDir, dirs.figuresDir);
        ensureDir(configDir);
        writeFileSync(configPath, defaultConfig({ homeDir }, overrides));
      };

      const writeSessionState = (filePath: string, isTempFile = false) => {
        ensureDir(stateDir);
        writeFileSync(
          sessionStatePath,
          JSON.stringify(
            {
              last_file: filePath,
              is_temp_file: isTempFile,
            },
            null,
            2,
          ),
        );
      };

      writeConfig();

      const realHomeDir = previousEnv.HOME ?? path.join(rootDir, 'real-home');

      process.env.HOME = homeDir;
      process.env.CARGO_HOME = previousEnv.CARGO_HOME ?? path.join(realHomeDir, '.cargo');
      process.env.RUSTUP_HOME =
        previousEnv.RUSTUP_HOME ?? path.join(realHomeDir, '.rustup');
      process.env.XDG_CONFIG_HOME = xdgConfigHome;
      process.env.XDG_STATE_HOME = xdgStateHome;
      process.env.PANDOC_PREVIEW_TEST_HOME = homeDir;
      process.env.PANDOC_PREVIEW_TEST_XDG_CONFIG_HOME = xdgConfigHome;
      process.env.PANDOC_PREVIEW_TEST_XDG_STATE_HOME = xdgStateHome;

      try {
        const env = {
          rootDir,
          homeDir,
          workspaceDir,
          xdgConfigHome,
          xdgStateHome,
          configPath,
          sessionStatePath,
          templatesDir,
          filtersDir,
          figuresDir,
          writeConfig,
          writeSessionState,
          readConfig: () => readFileSync(configPath, 'utf8'),
        };

        await launchSetup(env);

        await use({
          ...env,
        });
      } finally {
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
        rmSync(rootDir, { recursive: true, force: true });
      }
    },
    { auto: true },
  ],
  appPage: async ({ tauriPage }, use) => {
    // The tauriPage fixture from @srsholmes/tauri-playwright already:
    // 1. Launches the Tauri app using tauriCommand.
    // 2. Navigates the webview to devUrl (since configured in createTauriTest).
    // 3. Waits for window.__PW_ACTIVE__ to be true.

    // We only need to verify the initial frontend readiness locator before handing control to the test.
    await expect(tauriPage.getByTestId('editor')).toBeVisible({ timeout: 30000 });

    await use(tauriPage as import('@srsholmes/tauri-playwright').TauriPage);
  },
});

// Anchor the exported value to the package's named tauriExpect type surface
// instead of widening through `any`.
export const expect: typeof tauriExpect = base.expect;
