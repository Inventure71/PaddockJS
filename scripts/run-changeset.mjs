#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolManifestPath = resolve(repoRoot, 'tools/release/package.json');

try {
  const toolManifest = JSON.parse(readFileSync(toolManifestPath, 'utf8'));
  const toolRequire = createRequire(toolManifestPath);
  let cliManifestPath;
  try {
    cliManifestPath = toolRequire.resolve('@changesets/cli/package.json');
    const toolRelativePath = relative(resolve(repoRoot, 'tools/release/node_modules'), cliManifestPath);
    if (toolRelativePath.startsWith('..') || isAbsolute(toolRelativePath)) {
      throw new Error('Changesets was resolved outside the isolated release tools.');
    }
  } catch (error) {
    throw new Error('Install the isolated release tools with npm run tools:release:ci on a supported Node.js version.', { cause: error });
  }
  const cliManifest = JSON.parse(readFileSync(cliManifestPath, 'utf8'));
  if (cliManifest.version !== toolManifest.devDependencies['@changesets/cli']) {
    throw new Error('The release tools do not match their pinned version. Run npm run tools:release:ci.');
  }
  const { satisfies } = createRequire(cliManifestPath)('semver');
  if (!satisfies(process.versions.node, cliManifest.engines.node)) {
    throw new Error(`Changesets release tools require Node.js ${cliManifest.engines.node}; current Node.js is ${process.versions.node}. PaddockJS itself still supports Node.js >=20.19.0.`);
  }
  const result = spawnSync(process.execPath, [
    toolRequire.resolve('@changesets/cli/bin.js'),
    ...process.argv.slice(2),
  ], { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
