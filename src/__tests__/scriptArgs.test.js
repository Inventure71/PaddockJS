import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { parseBrowserSmokeArgs } from '../../smoke/browserSmokeArgs.mjs';
import { buildVitestArgs } from '../../scripts/vitestArgs.mjs';

describe('test script helpers', () => {
  test('forwards explicit Vitest targets after wrapper flags', () => {
    expect(buildVitestArgs(['--slow', 'src/__tests__/environment.test.js'])).toEqual([
      'run',
      'src/__tests__/environment.test.js',
      '--maxWorkers=1',
      '--testTimeout=30000',
    ]);
  });

  test('defaults to the full src suite with the stable worker cap', () => {
    expect(buildVitestArgs([])).toEqual(['run', 'src', '--maxWorkers=1']);
    expect(buildVitestArgs(['--slow'])).toEqual(['run', 'src', '--maxWorkers=1', '--testTimeout=30000']);
  });

  test('maps --runInBand to single-worker vitest mode', () => {
    expect(buildVitestArgs(['--runInBand'])).toEqual(['run', 'src', '--maxWorkers=1']);
  });

  test('emits only one worker limiter when --slow and --runInBand are both present', () => {
    expect(buildVitestArgs(['--slow', '--runInBand'])).toEqual(['run', 'src', '--maxWorkers=1', '--testTimeout=30000']);
  });
});

describe('browser smoke script helpers', () => {
  test('rejects unknown browser smoke flags before launching a preview', () => {
    expect(() => parseBrowserSmokeArgs(['--quick', '--skip-build', '--bogus'])).toThrow(
      'Unknown browser smoke argument: --bogus',
    );
  });

  test('rejects conflicting browser smoke modes before launching a preview', () => {
    expect(() => parseBrowserSmokeArgs(['--quick', '--full'])).toThrow('Choose either --quick or --full, not both');
  });

  test('parses browser smoke mode flags explicitly', () => {
    expect(parseBrowserSmokeArgs(['--quick', '--skip-build'], { skipBuildEnv: false })).toEqual({
      quickMode: true,
      fullMode: false,
      skipBuild: true,
    });
    expect(parseBrowserSmokeArgs(['--full'], { skipBuildEnv: true })).toEqual({
      quickMode: false,
      fullMode: true,
      skipBuild: true,
    });
  });

  test('prints browser smoke usage for help before launching a preview', () => {
    const result = spawnSync(process.execPath, ['smoke/browser-smoke.mjs', '--help'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node smoke/browser-smoke.mjs');
    expect(result.stdout).not.toContain('[browser-smoke]');
    expect(result.stderr).toBe('');
  });
});

describe('consumer verification script helpers', () => {
  test('prints consumer smoke usage for help before packing a workspace', () => {
    const result = spawnSync(process.execPath, ['scripts/consumer-package-smoke.mjs', '--help'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node scripts/consumer-package-smoke.mjs');
    expect(result.stdout).not.toContain('[consumer-smoke]');
    expect(result.stderr).toBe('');
  });

  test('rejects unknown consumer smoke arguments before packing a workspace', () => {
    const result = spawnSync(process.execPath, ['scripts/consumer-package-smoke.mjs', '--bogus'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: node scripts/consumer-package-smoke.mjs');
    expect(result.stderr).toContain('Unknown consumer smoke argument: --bogus');
  });

  test('prints bundle-boundary usage for help before packing a workspace', () => {
    const result = spawnSync(process.execPath, ['scripts/consumer-bundle-boundaries.mjs', '--help'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node scripts/consumer-bundle-boundaries.mjs');
    expect(result.stdout).not.toContain('[bundle-boundaries]');
    expect(result.stderr).toBe('');
  });

  test('rejects unknown bundle-boundary arguments before packing a workspace', () => {
    const result = spawnSync(process.execPath, ['scripts/consumer-bundle-boundaries.mjs', '--bogus'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: node scripts/consumer-bundle-boundaries.mjs');
    expect(result.stderr).toContain('Unknown bundle-boundary argument: --bogus');
  });
});

describe('track benchmark script helpers', () => {
  test('prints track benchmark usage for help before running benchmarks', () => {
    const result = spawnSync(process.execPath, ['scripts/benchmark-track-query-index.mjs', '--help'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node scripts/benchmark-track-query-index.mjs');
    expect(result.stdout).not.toContain('| benchmark |');
    expect(result.stderr).toBe('');
  });

  test('rejects unknown track benchmark arguments before running benchmarks', () => {
    const result = spawnSync(process.execPath, ['scripts/benchmark-track-query-index.mjs', '--bogus'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: node scripts/benchmark-track-query-index.mjs');
    expect(result.stderr).toContain('Unknown track benchmark argument: --bogus');
  });
});
