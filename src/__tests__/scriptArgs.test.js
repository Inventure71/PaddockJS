import { describe, expect, test } from 'vitest';
import { buildVitestArgs } from '../../scripts/vitestArgs.mjs';

describe('test script helpers', () => {
  test('forwards explicit Vitest targets after wrapper flags', () => {
    expect(buildVitestArgs(['--slow', 'src/__tests__/environment.test.js'])).toEqual([
      'run',
      'src/__tests__/environment.test.js',
    ]);
  });

  test('defaults to the full src suite when no explicit targets are provided', () => {
    expect(buildVitestArgs(['--slow'])).toEqual(['run', 'src']);
  });
});
