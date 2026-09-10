#!/usr/bin/env node
// Production demo fields at fixed simulation time; stdout is one JSON record per race.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'max-seconds': { type: 'string', default: '1200' },
  cases: { type: 'string' },
  repeats: { type: 'string', default: '1' },
  'demo-options': { type: 'string' },
  'physics-mode': { type: 'string', default: 'advanced' },
  help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: node scripts/benchmark-advanced-ai-fields.mjs [source-root] [--cases hero,components,dashboard,timing-overlay,compact-race,full-dashboard] [--max-seconds 1200] [--repeats 1] [--demo-options path] [--physics-mode arcade|advanced]');
  process.exit(0);
}
if (positionals.length > 1) throw new Error('Expected at most one source-root argument');
const root = resolve(positionals[0] ?? repository);
const physicsMode = values['physics-mode'];
if (!['arcade', 'advanced'].includes(physicsMode)) throw new Error('--physics-mode must be arcade or advanced');
const maxSeconds = Number(values['max-seconds']);
const repeats = Number(values.repeats);
if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) throw new Error('--max-seconds must be positive and finite');
if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error('--repeats must be a positive integer');
const allCases = [
  { name: 'hero', seed: 71, trackSeed: 7109, totalLaps: 5 },
  { name: 'components', seed: 72, trackSeed: 7110, totalLaps: 3 },
  ...['dashboard', 'timing-overlay', 'compact-race', 'full-dashboard'].map((name, index) => ({
    name, seed: 90 + index, trackSeed: 7200 + index, totalLaps: 3,
  })),
];
const requestedCases = values.cases?.split(',');
if (requestedCases?.some((name) => !allCases.some((entry) => entry.name === name))) {
  throw new Error('--cases contains an unknown demo field');
}
const cases = requestedCases ? allCases.filter(({ name }) => requestedCases.includes(name)) : allCases;
const targetDemo = join(root, 'demo/src/data/demoOptions.js');
const demoOptionsPath = resolve(values['demo-options'] ?? (existsSync(targetDemo) ? targetDemo : join(repository, 'demo/src/data/demoOptions.js')));
const demoSource = readFileSync(demoOptionsPath, 'utf8');
const dataUrl = pathToFileURL(join(root, 'src/data/index.js')).href;
const demoModule = demoSource.replace(/(['"])@inventure71\/paddockjs\1/g, JSON.stringify(dataUrl));
const { createDemoOptions } = await import(`data:text/javascript;base64,${Buffer.from(demoModule).toString('base64')}`);
const { normalizeSimulatorDrivers } = await import(dataUrl);
const { createRaceSimulation, FIXED_STEP } = await import(pathToFileURL(join(root, 'src/simulation/raceSimulation.js')));
const { simSpeedToKph, simUnitsToMeters } = await import(pathToFileURL(join(root, 'src/simulation/units.js')));
const { getTimingLineCrossingTime } = await import(pathToFileURL(join(root, 'src/simulation/timing/timingLines.js')));
const maximumFrames = Math.floor(maxSeconds / FIXED_STEP);
if (maximumFrames < 1) throw new Error('--max-seconds must include at least one fixed simulation step');
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
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
const incidentTypes = new Set(['contact', 'track-limits', 'pit-lane-speeding', 'car-dnf', 'car-destroyed']);
const pitControlled = (car) => ['entering', 'queued', 'servicing', 'exiting'].includes(car.pitStop?.status);
const terminal = (car) => car.finished || car.outOfRace || car.destroyed;

for (const scenario of cases) {
  let expectedResultHash = null;
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const { name, ...raceOptions } = scenario;
    const options = createDemoOptions({ ...raceOptions, physicsMode, warmup: false });
    const drivers = normalizeSimulatorDrivers(options.drivers, { entries: options.entries });
    const sim = createRaceSimulation({ ...options, drivers });
    const metrics = new Map(sim.cars.map((car) => [car.id, {
      lapCrossingTimes: [], offRoadFrames: 0,
      runningFrames: 0, runningSpeedSum: 0, maximumSpeedKph: 0,
    }]));
    const eventCounts = {};
    const incidentCounts = {};
    const incidents = [];
    const trajectoryHasher = createHash('sha256');
    const eventHasher = createHash('sha256');
    const snapshotEveryFrames = Math.max(1, Math.round(1 / FIXED_STEP));
    let frame = 0;
    for (; frame < maximumFrames && !sim.raceControl.finished; frame += 1) {
      // Capture activity before stepping so the final interval before a finish/DNF counts.
      const activeIds = new Set(sim.cars.filter((car) => !terminal(car) && !pitControlled(car)).map((car) => car.id));
      sim.step(FIXED_STEP);
      // runRaceStep replaces events each step. Consume that batch once; distinct
      // penalty consequences remain events, but are not additional physical incidents.
      const seen = new Set();
      for (const event of sim.events) {
        const key = JSON.stringify(event);
        if (seen.has(key)) continue;
        seen.add(key);
        eventHasher.update(JSON.stringify([frame + 1, event]));
        eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
        if (incidentTypes.has(event.type)) {
          incidentCounts[event.type] = (incidentCounts[event.type] ?? 0) + 1;
          incidents.push({ frame: frame + 1, at: event.at ?? sim.time, type: event.type,
            carId: event.carId ?? event.driverId, otherCarId: event.otherCarId,
            reason: event.reason, decision: event.decision, violationCount: event.violationCount });
        }
      }
      for (const car of sim.cars) {
        const metric = metrics.get(car.id);
        // Position synchronization can increment completedLaps without writing a
        // new lastLapTime during pit routing. Timing lines retain the actual
        // interpolated crossings, including distance advanced by the pit route.
        while (metric.lapCrossingTimes.length < scenario.totalLaps) {
          const lap = metric.lapCrossingTimes.length + 1;
          const crossing = getTimingLineCrossingTime(car, lap * sim.track.timingLines.count);
          if (crossing == null) break;
          metric.lapCrossingTimes.push(crossing);
        }
        if (!activeIds.has(car.id) || pitControlled(car) || car.trackState.inPitLane) continue;
        if (!car.trackState.onTrack) metric.offRoadFrames += 1;
        if (sim.raceControl.mode === 'pre-start') continue;
        const speedKph = simSpeedToKph(car.speed);
        metric.runningFrames += 1;
        metric.runningSpeedSum += speedKph;
        metric.maximumSpeedKph = Math.max(metric.maximumSpeedKph, speedKph);
      }
      if ((frame + 1) % snapshotEveryFrames === 0) trajectoryHasher.update(JSON.stringify(sim.snapshot()));
    }
    trajectoryHasher.update(JSON.stringify(sim.snapshot()));
    const raceStartedAt = sim.raceControl.start?.releasedAt ?? 0;
    const cars = sim.cars.map((car) => {
      const metric = metrics.get(car.id);
      if (car.finished && metric.lapCrossingTimes.length !== scenario.totalLaps) {
        throw new Error(`Missing finish-line crossings for finished car ${name}/${car.id}`);
      }
      return { id: car.id, finished: Boolean(car.finished), dnf: Boolean(car.outOfRace || car.destroyed),
        reason: car.dnfReason ?? car.destroyReason ?? null, finishTime: car.finishTime ?? null,
        dnfAt: car.dnfAt ?? car.destroyedAt ?? null, laps: car.raceDistance / sim.track.length,
        lapCrossingTimes: metric.lapCrossingTimes,
        lapTimes: metric.lapCrossingTimes.map((at, index) => at - (metric.lapCrossingTimes[index - 1] ?? raceStartedAt)),
        offRoadSeconds: metric.offRoadFrames * FIXED_STEP,
        meanRunningSpeedKph: metric.runningFrames ? metric.runningSpeedSum / metric.runningFrames : null,
        maximumSpeedKph: metric.maximumSpeedKph, tireEnergy: car.tireEnergy,
        pitStatus: car.pitStop?.status ?? null, pitStopsCompleted: car.pitStop?.stopsCompleted ?? 0 };
    });
    const result = { ...scenario, mode: physicsMode, fixedStep: FIXED_STEP, maximumSeconds: maxSeconds,
      trackLengthMeters: simUnitsToMeters(sim.track.length), frames: frame, seconds: sim.time, raceStartedAt,
      raceFinished: sim.raceControl.finished, fullFieldFinished: cars.every((car) => car.finished),
      finished: cars.filter((car) => car.finished).length, dnf: cars.filter((car) => car.dnf).length,
      active: cars.filter((car) => !car.finished && !car.dnf).length,
      eventCounts, incidentCounts, incidents, cars,
      trajectoryHash: trajectoryHasher.digest('hex'), eventHash: eventHasher.digest('hex') };
    const resultHash = hash(result);
    const deterministicMatch = expectedResultHash == null ? null : resultHash === expectedResultHash;
    expectedResultHash ??= resultHash;
    console.log(JSON.stringify({ benchmarkVersion: 2, root, demoOptionsPath, sourceHash,
      demoOptionsHash: hash(demoSource), optionsHash: hash({ ...options, drivers }),
      environment: { node: process.version, platform: platform(), arch: arch() },
      offRoadDefinition: 'active interval; wheel-derived trackState.onTrack false; outside active pit routing/pit lane',
      lapTimeDefinition: 'production timing-line crossings at whole race-distance laps; first interval starts at lights out, later intervals include pit routing and service; crossing times are absolute simulation seconds',
      repeat, deterministicMatch, ...result, resultHash }));
    if (deterministicMatch === false) process.exitCode = 1;
  }
}
