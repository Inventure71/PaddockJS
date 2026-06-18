import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');

describe('profile hotspots script', () => {
  test('rejects invalid step counts before reporting timing output', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(repoRoot, 'scripts/profile-hotspots.mjs'), 'nope'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: node scripts/profile-hotspots.mjs');
    expect(result.stderr).toContain('steps must be a positive integer');
    expect(result.stderr).not.toContain('steps=NaN');
  });

  test('rejects extra arguments before running the profiler', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(repoRoot, 'scripts/profile-hotspots.mjs'), '5', 'extra'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: node scripts/profile-hotspots.mjs');
    expect(result.stderr).toContain('Unexpected argument: extra');
  });

  test('prints usage for help without treating it as invalid input', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(repoRoot, 'scripts/profile-hotspots.mjs'), '--help'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node scripts/profile-hotspots.mjs');
    expect(result.stderr).toBe('');
  });
});
