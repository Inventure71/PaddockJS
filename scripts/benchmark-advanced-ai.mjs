#!/usr/bin/env node
// Fixed-step production races; wall-clock timing is deliberately not a lap metric.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'physics-mode': { type: 'string', default: 'advanced' },
  help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: node scripts/benchmark-advanced-ai.mjs [source-root] [comma-separated-track-seeds] [--physics-mode arcade|advanced]');
  process.exit(0);
}
if (positionals.length > 2) throw new Error('Expected source-root and optional comma-separated track seeds');
const physicsMode = values['physics-mode'];
if (!['arcade', 'advanced'].includes(physicsMode)) throw new Error('--physics-mode must be arcade or advanced');
const root = resolve(positionals[0] ?? '.');
const seeds = (positionals[1] ?? '7109,7110,7200,7201,12,26,61,20260427').split(',').map(Number);
const { createRaceSimulation, FIXED_STEP } = await import(pathToFileURL(`${root}/src/simulation/raceSimulation.js`));
const { PROJECT_DRIVERS } = await import(pathToFileURL(`${root}/src/data/demoDrivers.js`));
const { simSpeedToKph, simUnitsToMeters } = await import(pathToFileURL(`${root}/src/simulation/units.js`));

const sourceHasher = createHash('sha256');
function hashDirectory(relative) {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) hashDirectory(path);
    else if (entry.isFile() && entry.name.endsWith('.js')) sourceHasher.update(path).update('\0').update(readFileSync(join(root, path))).update('\0');
  }
}
hashDirectory('src/simulation');
hashDirectory('src/data');
const sourceHash = sourceHasher.digest('hex');

for (const trackSeed of seeds) {
  const sim = createRaceSimulation({
    seed: 100, trackSeed, physicsMode, drivers: PROJECT_DRIVERS.slice(0, 1), totalLaps: 3,
    rules: { standingStart: false, modules: { tireDegradation: { enabled: false } } },
  });
  const car = sim.cars[0];
  const laps = [];
  let previousLaps = 0;
  let offRoadFrames = 0;
  let maximumSpeedKph = 0;
  let frames = 0;
  const hash = createHash('sha256');
  for (; frames < 900 / FIXED_STEP && !car.finished && !car.outOfRace && !car.destroyed; frames += 1) {
    sim.step(FIXED_STEP);
    if (!car.trackState.onTrack) offRoadFrames += 1;
    maximumSpeedKph = Math.max(maximumSpeedKph, simSpeedToKph(car.speed));
    if (car.lapTelemetry.completedLaps > previousLaps) {
      laps.push(car.lapTelemetry.lastLapTime);
      previousLaps = car.lapTelemetry.completedLaps;
    }
    if (frames % 60 === 0) hash.update(JSON.stringify(sim.snapshot()));
  }
  console.log(JSON.stringify({
    mode: physicsMode, sourceHash,
    trackSeed, seed: 100, fixedStep: FIXED_STEP, trackLengthMeters: simUnitsToMeters(sim.track.length),
    laps, elapsedSeconds: frames * FIXED_STEP, finished: Boolean(car.finished),
    dnf: Boolean(car.outOfRace || car.destroyed), offRoadSeconds: offRoadFrames * FIXED_STEP,
    maximumSpeedKph, hash: hash.digest('hex'),
  }));
}
