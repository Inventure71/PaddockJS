#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVitestArgs } from './vitestArgs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const includeSlowTests = process.argv.includes('--slow');
const explicitTargets = process.argv.slice(2).filter((arg) => arg !== '--slow' && arg !== '--runInBand');
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

if (includeSlowTests && explicitTargets.length === 0) {
  const slowTestFiles = discoverVitestTestFiles(resolve(repoRoot, 'src', '__tests__'));
  const batches = chunk(slowTestFiles, 1);
  batches.forEach((batch, index) => {
    process.stdout.write(`[run-vitest] slow batch ${index + 1}/${batches.length}\n`);
    execVitest(['--slow', ...batch]);
  });
} else {
  execVitest(process.argv.slice(2));
}

function execVitest(args) {
  execFileSync(vitestBin, buildVitestArgs(args), {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
  });
}

function discoverVitestTestFiles(root) {
  return walk(root)
    .filter((path) => /\.test\.[cm]?[jt]sx?$/.test(path))
    .map((path) => path.slice(repoRoot.length + 1))
    .sort();
}

function walk(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
