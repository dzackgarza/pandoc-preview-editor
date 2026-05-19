import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ScorecardContract {
  startup: 'pass' | 'fail' | 'not_tested';
  terminal_input_to_nvim: 'pass' | 'fail' | 'not_tested';
  nvim_to_preview: 'pass' | 'fail' | 'not_tested';
  save_latest_buffer: 'pass' | 'fail' | 'not_tested';
  pandoc_math: 'pass' | 'fail' | 'not_tested';
  citations: 'pass' | 'fail' | 'not_tested' | 'not_implemented';
  export: 'pass' | 'fail' | 'not_tested' | 'not_implemented';
  crash_recovery: 'pass' | 'fail' | 'not_tested' | 'not_implemented';
}

export interface ScorecardEnvironment {
  node: string;
  nvim: string;
  pandoc: string;
  browser: string;
}

export interface CertificationScorecard {
  certified: boolean;
  commit: string;
  date: string;
  environment: ScorecardEnvironment;
  contracts: ScorecardContract;
  artifacts: string;
}

function getVersion(cmd: string, flag: string): string {
  try {
    return execFileSync(cmd, [flag], { encoding: 'utf-8', timeout: 3000 }).trim();
  } catch {
    return 'unknown';
  }
}

function getCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function generateScorecard(
  contracts: ScorecardContract,
  artifactsRoot: string,
): CertificationScorecard {
  const allPass = Object.values(contracts).every(
    (v) => v === 'pass' || v === 'not_implemented',
  );

  const scorecard: CertificationScorecard = {
    certified: allPass,
    commit: getCommit(),
    date: new Date().toISOString(),
    environment: {
      node: getVersion('node', '--version'),
      nvim: getVersion('nvim', '--version').split('\n')[0] || 'unknown',
      pandoc: getVersion('pandoc', '--version').split('\n')[0] || 'unknown',
      browser: 'chromium (Playwright)',
    },
    contracts,
    artifacts: artifactsRoot,
  };

  writeFileSync(
    join(artifactsRoot, 'scorecard.json'),
    JSON.stringify(scorecard, null, 2),
    'utf-8',
  );

  return scorecard;
}
