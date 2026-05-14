#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVitestArgs } from './vitestArgs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const includeSlowTests = process.argv.includes('--slow');
const vitestBin = resolve(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
);

const env = { ...process.env };
if (includeSlowTests) {
  env.PADDOCKJS_INCLUDE_SLOW_TESTS = '1';
} else {
  delete env.PADDOCKJS_INCLUDE_SLOW_TESTS;
}

execFileSync(vitestBin, buildVitestArgs(process.argv.slice(2)), {
  cwd: repoRoot,
  stdio: 'inherit',
  env,
});
