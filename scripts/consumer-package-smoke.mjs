#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = join(tmpdir(), `paddockjs-consumer-${process.pid}`);
const packDir = join(workspaceRoot, 'pack');
const appDir = join(workspaceRoot, 'app');

function run(command, args, options = {}) {
  console.log(`[consumer-smoke] ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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
  writeFileSync(join(appDir, 'index.html'), [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>PaddockJS Consumer Smoke</title></head>',
    '<body>',
    '  <div id="f1-simulator-root"></div>',
    '  <script type="module" src="/src/main.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n'));
  writeFileSync(join(appDir, 'src/main.js'), `
import { mountF1Simulator } from '@inventure71/paddockjs';
import { createPaddockEnvironment, createProgressReward } from '@inventure71/paddockjs/environment';

const drivers = [
  {
    id: 'consumer-alpha',
    name: 'Consumer Alpha',
    color: '#e10600',
    raceData: ['Packed install smoke', 'Vite consumer build'],
  },
  {
    id: 'consumer-beta',
    name: 'Consumer Beta',
    color: '#00ff84',
    raceData: ['External host data', 'No repo internals'],
  },
];

const entries = [
  {
    driverId: 'consumer-alpha',
    driverNumber: 71,
    timingName: 'Alpha',
    driver: { pace: 60, racecraft: 58, aggression: 45, riskTolerance: 42, patience: 70, consistency: 80 },
    vehicle: { id: 'ca-01', name: 'CA-01', power: 60, braking: 62, aero: 58, dragEfficiency: 55, mechanicalGrip: 65, weightControl: 58, tireCare: 72 },
  },
  {
    driverId: 'consumer-beta',
    driverNumber: 17,
    timingName: 'Beta',
    driver: { pace: 55, racecraft: 64, aggression: 38, riskTolerance: 48, patience: 75, consistency: 78 },
    vehicle: { id: 'cb-02', name: 'CB-02', power: 58, braking: 60, aero: 62, dragEfficiency: 60, mechanicalGrip: 60, weightControl: 57, tireCare: 74 },
  },
];

const env = createPaddockEnvironment({
  drivers,
  entries,
  controlledDrivers: ['consumer-alpha'],
  reward: createProgressReward(),
  seed: 71,
  trackSeed: 20260507,
});
const result = env.step({ 'consumer-alpha': { steering: 0, throttle: 1, brake: 0 } });
if (!result.observation['consumer-alpha']) {
  throw new Error('Packed environment import did not produce a controlled-driver observation.');
}
env.destroy();

const root = document.getElementById('f1-simulator-root');
if (root) {
  mountF1Simulator(root, {
    drivers,
    entries,
    preset: 'compact-race',
    trackSeed: 20260507,
    totalLaps: 2,
    onDriverOpen() {},
  });
}
`);
}

try {
  if (existsSync(workspaceRoot)) rmSync(workspaceRoot, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  mkdirSync(appDir, { recursive: true });

  run('npm', ['pack', '--pack-destination', packDir]);
  const packageTarball = readdirSync(packDir)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(packDir, name))[0];
  if (!packageTarball) {
    throw new Error(`npm pack did not create a tarball in ${packDir}`);
  }

  createConsumerApp(packageTarball);
  run('npm', ['install'], { cwd: appDir });
  run('npm', ['run', 'build'], { cwd: appDir });
  console.log('[consumer-smoke] packed package installed and built in a fresh Vite consumer app');
} finally {
  if (process.env.PADDOCKJS_KEEP_CONSUMER_SMOKE !== '1') {
    rmSync(workspaceRoot, { recursive: true, force: true });
  } else {
    console.log(`[consumer-smoke] kept temp workspace: ${workspaceRoot}`);
  }
}
