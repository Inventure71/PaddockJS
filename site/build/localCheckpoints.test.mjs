import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { discoverLocalCheckpoints } from './localCheckpoints.mjs';

test('optional exports are absent by default and retain preferred order when supplied', () => {
  const publicDirectory = mkdtempSync(resolve(tmpdir(), 'paddock-local-policies-'));
  try {
    assert.deepEqual(discoverLocalCheckpoints(publicDirectory), []);
    const directory = resolve(publicDirectory, 'local-checkpoints');
    mkdirSync(directory);
    writeFileSync(resolve(directory, 'latest-hybrid-policy.json'), '{}');
    assert.deepEqual(discoverLocalCheckpoints(publicDirectory), [
      '/local-checkpoints/latest-hybrid-policy.json',
    ]);
    writeFileSync(resolve(directory, 'latest-distilled-policy.json'), '{}');
    assert.deepEqual(discoverLocalCheckpoints(publicDirectory), [
      '/local-checkpoints/latest-distilled-policy.json',
      '/local-checkpoints/latest-hybrid-policy.json',
    ]);
  } finally {
    rmSync(publicDirectory, { recursive: true });
  }
});
