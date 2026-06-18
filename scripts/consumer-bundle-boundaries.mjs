#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = join(tmpdir(), `paddockjs-bundle-boundaries-${process.pid}`);
const packDir = join(workspaceRoot, 'pack');
const appDir = join(workspaceRoot, 'app');
const distDir = join(appDir, 'dist');
const defaultNpmCacheDir = join(homedir(), '.npm');
const inheritedNpmCacheDir = process.env.npm_config_cache ?? process.env.NPM_CONFIG_CACHE ?? '';
const npmCacheDir = isExplicitNpmCache(inheritedNpmCacheDir)
  ? inheritedNpmCacheDir
  : join(workspaceRoot, 'npm-cache');
const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : 'npm';
const npmBaseArgs = npmExecPath ? [npmExecPath] : [];

function usage() {
  return 'Usage: node scripts/consumer-bundle-boundaries.mjs [--help]';
}

function parseArgs(args = process.argv.slice(2)) {
  if (args.some((arg) => arg === '--help' || arg === '-h')) {
    console.log(usage());
    process.exit(0);
  }
  if (args.length > 0) {
    throw new Error(`Unknown bundle-boundary argument: ${args[0]}`);
  }
}

const BUDGETS = {
  root: {
    maxJsBytes: 1_250_000,
    minCssBytes: 75_000,
    minAssetBytes: 5_000,
  },
  placeholder: {
    maxJsBytes: 20_000,
    maxCssBytes: 8_000,
    maxAssetBytes: 0,
  },
  data: {
    maxJsBytes: 260_000,
    maxCssBytes: 0,
    maxAssetBytes: 0,
  },
  environment: {
    maxJsBytes: 760_000,
    maxCssBytes: 0,
    maxAssetBytes: 0,
  },
};

function run(command, args, options = {}) {
  console.log(`[bundle-boundaries] ${command} ${args.join(' ')}`);
  execFileSync(options.command ?? command, options.args ?? args, {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_cache: npmCacheDir,
      npm_config_fund: 'false',
      NPM_CONFIG_CACHE: npmCacheDir,
    },
  });
}

function runNpm(args, options = {}) {
  run('npm', args, {
    ...options,
    command: npmCommand,
    args: [...npmBaseArgs, ...args],
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path, lines) {
  writeFileSync(path, `${lines.join('\n')}\n`);
}

function isExplicitNpmCache(cacheDir) {
  return Boolean(cacheDir) && resolve(cacheDir) !== resolve(defaultNpmCacheDir);
}

function createConsumerApp(packageTarball) {
  mkdirSync(join(appDir, 'src'), { recursive: true });
  writeJson(join(appDir, 'package.json'), {
    private: true,
    type: 'module',
    scripts: {
      build: 'vite build',
    },
    dependencies: {
      '@inventure71/paddockjs': `file:${packageTarball}`,
      vite: '8.0.10',
    },
    devDependencies: {},
  });
  writeText(join(appDir, 'vite.config.js'), [
    "import { resolve } from 'node:path';",
    "import { defineConfig } from 'vite';",
    '',
    'export default defineConfig({',
    '  build: {',
    '    manifest: true,',
    '    rollupOptions: {',
    '      input: {',
    "        root: resolve(__dirname, 'root.html'),",
    "        placeholder: resolve(__dirname, 'placeholder.html'),",
    "        data: resolve(__dirname, 'data.html'),",
    "        environment: resolve(__dirname, 'environment.html'),",
    '      },',
    '    },',
    '  },',
    '});',
  ]);
  writeHtml('root', '/src/root.js');
  writeHtml('placeholder', '/src/placeholder.js');
  writeHtml('data', '/src/data.js');
  writeHtml('environment', '/src/environment.js');
  writeText(join(appDir, 'src/root.js'), [
    'import {',
    '  DEFAULT_PADDOCK_THEME,',
    '  createPaddockSimulator,',
    '  mountF1Simulator,',
    '  resolvePaddockTheme,',
    "} from '@inventure71/paddockjs';",
    '',
    'globalThis.__paddockRootBoundary = {',
    '  mountF1Simulator,',
    '  createPaddockSimulator,',
    "  themeMode: resolvePaddockTheme(DEFAULT_PADDOCK_THEME).activeMode,",
    '};',
  ]);
  writeText(join(appDir, 'src/placeholder.js'), [
    "import { createPaddockLoadingPlaceholder } from '@inventure71/paddockjs/placeholder';",
    "import '@inventure71/paddockjs/placeholder.css';",
    '',
    'globalThis.__paddockPlaceholderBoundary = createPaddockLoadingPlaceholder({',
    "  label: 'Loading simulator',",
    "  detail: 'Packed placeholder boundary',",
    '});',
  ]);
  writeText(join(appDir, 'src/data.js'), [
    'import {',
    '  DriverData,',
    '  createProceduralTrack,',
    '  formatDriverNumber,',
    '  normalizeSimulatorDrivers,',
    "} from '@inventure71/paddockjs/data';",
    '',
    'const drivers = [{ id: "data-alpha", name: "Data Alpha", color: "#e10600" }];',
    'const entries = [{ driverId: "data-alpha", driverNumber: 71 }];',
    'const track = createProceduralTrack(7101, { profile: "training-short" });',
    '',
    'globalThis.__paddockDataBoundary = {',
    '  normalized: normalizeSimulatorDrivers(drivers, { entries }),',
    '  driver: new DriverData({ pace: 71 }),',
    '  number: formatDriverNumber(entries[0].driverNumber),',
    '  trackSampleCount: track.sampleCount,',
    '};',
  ]);
  writeText(join(appDir, 'src/environment.js'), [
    'import {',
    '  createPaddockEnvironment,',
    '  createProgressReward,',
    "} from '@inventure71/paddockjs/environment';",
    '',
    'const drivers = [{ id: "env-alpha", name: "Env Alpha", color: "#00ff84" }];',
    'const entries = [{ driverId: "env-alpha", driverNumber: 17 }];',
    '',
    'globalThis.__paddockEnvironmentBoundary = () => {',
    '  const env = createPaddockEnvironment({',
    '    drivers,',
    '    entries,',
    '    controlledDrivers: ["env-alpha"],',
    '    reward: createProgressReward(),',
    '    seed: 71,',
    '    trackSeed: 20260507,',
    '    trackGeneration: { profile: "training-short" },',
    '  });',
    '  const result = env.step({ "env-alpha": { steering: 0, throttle: 1, brake: 0 } });',
    '  env.destroy();',
    '  return result.info.controlledDrivers;',
    '};',
  ]);
}

function writeHtml(name, scriptPath) {
  writeText(join(appDir, `${name}.html`), [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>PaddockJS Boundary</title></head>',
    '<body>',
    `  <script type="module" src="${scriptPath}"></script>`,
    '</body>',
    '</html>',
  ]);
}

function readManifest() {
  const candidates = [
    join(distDir, '.vite', 'manifest.json'),
    join(distDir, 'manifest.json'),
  ];
  const manifestPath = candidates.find((path) => existsSync(path));
  if (!manifestPath) {
    throw new Error('Vite build did not emit a manifest.');
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function resolveEntry(manifest, name) {
  const entry = Object.values(manifest).find((chunk) => {
    if (!chunk?.isEntry) return false;
    return chunk.name === name ||
      chunk.src === `${name}.html` ||
      chunk.src === `src/${name}.js` ||
      chunk.file?.includes(`${name}-`);
  });
  if (!entry) {
    throw new Error(`Could not find ${name} entry in Vite manifest.`);
  }
  return entry;
}

function collectEntryFiles(manifest, entry) {
  const jsFiles = new Set();
  const cssFiles = new Set();
  const assetFiles = new Set();
  const visited = new Set();

  function visit(chunk) {
    if (!chunk?.file || visited.has(chunk.file)) return;
    visited.add(chunk.file);
    if (chunk.file.endsWith('.js')) jsFiles.add(chunk.file);
    chunk.css?.forEach((file) => cssFiles.add(file));
    chunk.assets?.forEach((file) => assetFiles.add(file));
    chunk.imports?.forEach((importKey) => visit(manifest[importKey]));
    chunk.dynamicImports?.forEach((importKey) => visit(manifest[importKey]));
  }

  visit(entry);
  return {
    jsFiles: [...jsFiles].sort(),
    cssFiles: [...cssFiles].sort(),
    assetFiles: [...assetFiles].sort(),
  };
}

function fileSize(file) {
  return statSync(join(distDir, file)).size;
}

function gzipSize(file) {
  return gzipSync(readFileSync(join(distDir, file))).length;
}

function summarizeFiles(files) {
  const bytes = files.reduce((total, file) => total + fileSize(file), 0);
  const gzipBytes = files.reduce((total, file) => total + gzipSize(file), 0);
  return { bytes, gzipBytes };
}

function summarizeEntry(name, files) {
  const js = summarizeFiles(files.jsFiles);
  const css = summarizeFiles(files.cssFiles);
  const assets = summarizeFiles(files.assetFiles);
  return {
    name,
    jsBytes: js.bytes,
    jsGzipBytes: js.gzipBytes,
    cssBytes: css.bytes,
    cssGzipBytes: css.gzipBytes,
    assetBytes: assets.bytes,
    files,
  };
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function assertBudget(summary) {
  const budget = BUDGETS[summary.name];
  assertMax(summary.jsBytes, budget.maxJsBytes, summary.name, 'JavaScript');
  assertMax(summary.cssBytes, budget.maxCssBytes, summary.name, 'CSS');
  assertMax(summary.assetBytes, budget.maxAssetBytes, summary.name, 'asset');
  assertMin(summary.cssBytes, budget.minCssBytes, summary.name, 'CSS');
  assertMin(summary.assetBytes, budget.minAssetBytes, summary.name, 'asset');
}

function assertMax(actual, max, name, label) {
  if (typeof max !== 'number') return;
  if (actual > max) {
    throw new Error(`${name} ${label} bundle is ${formatBytes(actual)}, above ${formatBytes(max)}.`);
  }
}

function assertMin(actual, min, name, label) {
  if (typeof min !== 'number') return;
  if (actual < min) {
    throw new Error(`${name} ${label} bundle is ${formatBytes(actual)}, below expected ${formatBytes(min)}.`);
  }
}

function printSummary(summary) {
  console.log([
    `[bundle-boundaries] ${summary.name}:`,
    `js=${formatBytes(summary.jsBytes)} (${formatBytes(summary.jsGzipBytes)} gzip)`,
    `css=${formatBytes(summary.cssBytes)} (${formatBytes(summary.cssGzipBytes)} gzip)`,
    `assets=${formatBytes(summary.assetBytes)}`,
  ].join(' '));
}

try {
  parseArgs();
} catch (error) {
  console.error(`${usage()}\n\n${error.message}`);
  process.exit(1);
}

try {
  if (existsSync(workspaceRoot)) rmSync(workspaceRoot, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  mkdirSync(appDir, { recursive: true });

  runNpm(['pack', '--pack-destination', packDir]);
  const packageTarball = readdirSync(packDir)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(packDir, name))[0];
  if (!packageTarball) {
    throw new Error(`npm pack did not create a tarball in ${packDir}`);
  }

  createConsumerApp(packageTarball);
  runNpm(['install'], { cwd: appDir });
  runNpm(['run', 'build'], { cwd: appDir });

  const manifest = readManifest();
  const summaries = ['root', 'placeholder', 'data', 'environment'].map((name) => (
    summarizeEntry(name, collectEntryFiles(manifest, resolveEntry(manifest, name)))
  ));
  summaries.forEach(printSummary);
  summaries.forEach(assertBudget);
  console.log('[bundle-boundaries] packed package subpath bundle boundaries verified');
} finally {
  if (process.env.PADDOCKJS_KEEP_CONSUMER_BUNDLE_BOUNDARIES !== '1') {
    rmSync(workspaceRoot, { recursive: true, force: true });
  } else {
    console.log(`[bundle-boundaries] kept temp workspace: ${workspaceRoot}`);
  }
}
