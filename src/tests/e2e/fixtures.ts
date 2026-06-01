import { createTauriTest } from '@srsholmes/tauri-playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Kill orphaned Tauri dev process trees left after a test run.
 *
 * The tauri-playwright adapter's stop() sends SIGTERM to the child process
 * (run-tauri-dev.sh), but the script's `exec` replaced the shell with `npx`,
 * which does NOT propagate signals to its cargo/binary children.
 *
 * run-tauri-dev.sh has been updated to trap EXIT and propagate kills to the
 * process group. This function is a safety net: if anything still leaks,
 * kill it by matching the test-specific XDG config directory that only
 * test processes use.
 */
function killOrphanedTauriProcesses() {
  // The test environment sets a unique PANDOC_PREVIEW_TEST_HOME per test run.
  // We match processes whose command line includes that path, which isolates
  // the kill to only processes launched by this test suite (not user dev servers).
  const testHome = process.env.PANDOC_PREVIEW_TEST_HOME;
  if (testHome) {
    try {
      execFileSync('pkill', ['-f', testHome], { stdio: 'pipe' });
    } catch {
      // No matching processes — nothing to clean up.
    }
  }
}

const repoRoot = process.cwd();
const devUrl = 'http://localhost:5173';

const base = createTauriTest({
  devUrl,
  tauriCommand: 'src/tests/e2e/run-tauri-dev.sh',
  tauriCwd: repoRoot,
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
  writeConfig: (overrides?: {
    debounceMs?: number;
    timeoutMs?: number;
    restoreLastFile?: boolean;
    renderCommand?: string;
    templatesDir?: string;
    filtersDir?: string;
  }) => void;
  writeSessionState: (filePath: string, isTempFile?: boolean) => void;
  readConfig: () => string;
};

type LaunchSetup = (env: TestEnvironment) => void | Promise<void>;

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultConfig(
  env: Pick<TestEnvironment, 'homeDir'>,
  overrides: Parameters<TestEnvironment['writeConfig']>[0] = {},
) {
  const templatesDir =
    overrides.templatesDir ?? path.join(env.homeDir, '.pandoc', 'templates');
  const filtersDir =
    overrides.filtersDir ?? path.join(env.homeDir, '.pandoc', 'filters');

  return `[render]
debounce_ms = ${overrides.debounceMs ?? 50}
timeout_ms = ${overrides.timeoutMs ?? 30000}
restore_last_file = ${overrides.restoreLastFile ?? true}

[pandoc]
render_command = ${JSON.stringify(
    overrides.renderCommand ??
      'pandoc -f markdown+tex_math_dollars+citations --standalone --to=html5',
  )}
templates_dir = ${JSON.stringify(templatesDir)}
filters_dir = ${JSON.stringify(filtersDir)}
`;
}

export const test = base.test.extend<{
  launchSetup: LaunchSetup;
  testEnv: TestEnvironment;
  appPage: import('@srsholmes/tauri-playwright').TauriPage;
}>({
  launchSetup: [
    async ({}, use) => {
      await use(async () => {});
    },
    { option: true },
  ],
  testEnv: async ({ launchSetup }, use) => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'pandoc-preview-e2e-'));
    const homeDir = path.join(rootDir, 'home');
    const workspaceDir = path.join(rootDir, 'workspace');
    const xdgConfigHome = path.join(rootDir, 'xdg-config');
    const xdgStateHome = path.join(rootDir, 'xdg-state');
    const configDir = path.join(xdgConfigHome, 'pandoc-preview');
    const stateDir = path.join(xdgStateHome, 'pandoc-preview');
    const configPath = path.join(configDir, 'config.toml');
    const sessionStatePath = path.join(stateDir, 'state.json');

    for (const dir of [
      homeDir,
      workspaceDir,
      configDir,
      stateDir,
      path.join(homeDir, '.pandoc', 'templates'),
      path.join(homeDir, '.pandoc', 'filters'),
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
  appPage: async ({ testEnv, tauriPage }, use) => {
    const startupDeadline = Date.now() + 30_000;
    let lastStartupError: unknown;

    while (Date.now() < startupDeadline) {
      try {
        await tauriPage.evaluate('window.location.href');
        lastStartupError = null;
        break;
      } catch (error) {
        lastStartupError = error;
        await delay(250);
      }
    }

    if (lastStartupError) {
      throw lastStartupError;
    }

    await tauriPage.evaluate(`window.location.href = ${JSON.stringify(devUrl)}`);

    const readyDeadline = Date.now() + 30_000;
    let frontendReady = false;
    let lastReadyError: unknown;

    while (Date.now() < readyDeadline) {
      try {
        frontendReady = await tauriPage.evaluate(
          'document.readyState === "complete" && !!window.__PW_ACTIVE__',
        );
        if (frontendReady) {
          break;
        }
      } catch (error) {
        lastReadyError = error;
      }
      await delay(250);
    }

    if (!frontendReady) {
      throw (
        lastReadyError ?? new Error('Timed out waiting for Tauri frontend readiness')
      );
    }

    await use(tauriPage as import('@srsholmes/tauri-playwright').TauriPage);
  },
});

// Kill orphaned Tauri processes after every test file.
// The adapter's stop() only SIGTERMs the direct child (npx tauri dev),
// not the cargo/binary grandchildren that produce the visible GUI window.
test.afterAll(async () => {
  killOrphanedTauriProcesses();
});

export const expect = base.expect;
