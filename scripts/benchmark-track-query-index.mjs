import { createPaddockEnvironment } from '../src/environment/index.js';
import { buildRaySensors } from '../src/environment/sensors.js';
import { createRaceSimulation } from '../src/simulation/raceSimulation.js';
import { TRACK, buildTrackModel, nearestTrackState, offsetTrackPoint, pointAt } from '../src/simulation/trackModel.js';
import {
  attachTrackQueryIndex,
  createTrackQueryIndex,
  resetTrackQueryStats,
  snapshotTrackQueryStats,
} from '../src/simulation/track/trackQueryIndex.js';
import { metersToSimUnits, simUnitsToMeters } from '../src/simulation/units.js';
import { applyWheelSurfaceState } from '../src/simulation/vehicle/wheelSurface.js';

const DEFAULT_DRIVERS = Array.from({ length: 20 }, (_, index) => ({
  id: `agent-${index}`,
  code: `A${index}`,
  name: `Agent ${index}`,
  color: ['#e10600', '#00a3ff', '#f1c65b', '#38bdf8', '#22c55e'][index % 5],
  tire: 'M',
  pace: 1,
  racecraft: 0.8,
}));

const DEFAULT_ENTRIES = DEFAULT_DRIVERS.map((driver, index) => ({
  driverId: driver.id,
  driverNumber: 70 + index,
  timingName: driver.code,
  driver: {
    pace: 75,
    racecraft: 75,
    aggression: 55,
    riskTolerance: 55,
    patience: 65,
    consistency: 70,
  },
  vehicle: {
    id: `agent-car-${index}`,
    name: `Agent ${index}`,
    power: 75,
    braking: 70,
    aero: 72,
    dragEfficiency: 68,
    mechanicalGrip: 74,
    weightControl: 70,
    tireCare: 70,
  },
}));

function setIndexEnabled(track, enabled) {
  if (enabled) {
    if (!track.queryIndex) attachTrackQueryIndex(track, createTrackQueryIndex(track));
    return;
  }
  if (track.queryIndex) delete track.queryIndex;
}

function measure(label, enabled, fn, { iterations = 1, warmup = 0 } = {}) {
  const track = buildTrackModel(TRACK);
  setIndexEnabled(track, enabled);
  for (let index = 0; index < warmup; index += 1) fn(track);
  resetTrackQueryStats(track);
  let returnedStats = null;
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const result = fn(track);
    returnedStats = mergeStats(returnedStats, result?.queryStats ?? null);
  }
  const total = performance.now() - start;
  return {
    label,
    mode: enabled ? 'indexed' : 'legacy-disabled',
    totalMs: total,
    msPerIteration: total / iterations,
    queryStats: mergeStats(snapshotTrackQueryStats(track), returnedStats),
  };
}

function precomputeNearestQueries(track) {
  const offsets = [
    0,
    track.width * 0.48,
    track.width / 2 + track.kerbWidth * 0.5,
    track.width / 2 + track.kerbWidth + track.gravelWidth * 0.55,
    track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth * 0.65,
    track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth + metersToSimUnits(6),
  ];
  return Array.from({ length: 720 }, (_, index) => {
    const distance = (track.length * index) / 720;
    const center = pointAt(track, distance);
    return offsets.map((offset) => ({
      position: offsetTrackPoint(center, offset),
      progressHint: center.distance,
    }));
  }).flat();
}

function nearestBenchmark(track) {
  const queries = precomputeNearestQueries(track);
  queries.forEach(({ position, progressHint }) => {
    nearestTrackState(track, position, progressHint, { allowPitOverride: false });
  });
}

function pitBenchmark(track) {
  const pitLane = track.pitLane;
  const points = [
    ...pitLane.entry.roadCenterline,
    ...pitLane.mainLane.points,
    ...(pitLane.workingLane?.points ?? []),
    ...pitLane.exit.roadCenterline,
    ...pitLane.boxes.map((box) => box.center),
    ...pitLane.serviceAreas.flatMap((area) => [area.center, area.queuePoint]),
  ];
  for (let iteration = 0; iteration < 16; iteration += 1) {
    points.forEach((point) => {
      nearestTrackState(track, point, point.distance ?? null);
    });
  }
}

function rayBenchmark(track) {
  const sim = createRaceSimulation({
    drivers: DEFAULT_DRIVERS.slice(0, 2),
    entries: DEFAULT_ENTRIES,
    track: TRACK,
    physicsMode: 'simulator',
    rules: { standingStart: false, modules: { pitStops: { enabled: false } } },
  });
  setIndexEnabled(sim.track, Boolean(track.queryIndex));
  const snapshot = sim.snapshot();
  const center = pointAt(snapshot.track, metersToSimUnits(900));
  const offset = snapshot.track.width / 2 +
    snapshot.track.kerbWidth +
    snapshot.track.gravelWidth +
    snapshot.track.runoffWidth +
    metersToSimUnits(55);
  const position = offsetTrackPoint(center, offset);
  const car = {
    ...snapshot.cars[0],
    x: position.x,
    y: position.y,
    heading: center.heading - Math.PI / 2,
    progress: center.distance,
    signedOffset: offset,
    interaction: { profile: 'normal' },
  };

  for (let iteration = 0; iteration < 80; iteration += 1) {
    buildRaySensors(car, snapshot, {
      rays: [
        { id: 'front-left', angleDegrees: -40, lengthMeters: 220 },
        { id: 'front', angleDegrees: 0, lengthMeters: 260 },
        { id: 'front-right', angleDegrees: 40, lengthMeters: 220 },
      ],
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
    });
  }
  return { queryStats: snapshotTrackQueryStats(sim.track) };
}

function wheelBenchmark(track) {
  const sim = createRaceSimulation({
    drivers: DEFAULT_DRIVERS.slice(0, 1),
    entries: DEFAULT_ENTRIES,
    track: TRACK,
    physicsMode: 'simulator',
    rules: { standingStart: false },
  });
  setIndexEnabled(sim.track, Boolean(track.queryIndex));
  const car = sim.cars[0];
  const pitLane = sim.track.pitLane;
  const entry = pointAt(sim.track, pitLane.entry.trackDistance - metersToSimUnits(8));
  const position = offsetTrackPoint(entry, sim.track.width / 2 + sim.track.kerbWidth * 0.35);
  sim.setCarState(car.id, {
    x: position.x,
    y: position.y,
    heading: entry.heading,
    speed: 0,
    progress: entry.distance,
    raceDistance: entry.distance,
  });

  for (let iteration = 0; iteration < 500; iteration += 1) {
    car.wheelSurfaceCache = null;
    applyWheelSurfaceState(car, sim.track);
  }
  return { queryStats: snapshotTrackQueryStats(sim.track) };
}

function createBatchEnvironment(indexed) {
  return createPaddockEnvironment({
    drivers: DEFAULT_DRIVERS,
    entries: DEFAULT_ENTRIES,
    controlledDrivers: DEFAULT_DRIVERS.map((driver) => driver.id),
    seed: 71,
    track: TRACK,
    trackQueryIndex: indexed,
    physicsMode: 'simulator',
    frameSkip: 4,
    participantInteractions: { defaultProfile: 'batch-training' },
    scenario: { participants: DEFAULT_DRIVERS.map((driver) => driver.id) },
    observation: { profile: 'physical-driver', output: 'vector', includeSchema: false },
    result: { stateOutput: 'none' },
    sensors: {
      rays: {
        enabled: true,
        layout: 'driver-front-heavy',
        channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
      },
      nearbyCars: { enabled: false },
    },
    rules: {
      standingStart: false,
      modules: {
        pitStops: { enabled: false },
        tireDegradation: { enabled: false },
      },
    },
    episode: { maxSteps: 1000, endOnRaceFinish: false },
  });
}

function batchEnvironmentBenchmark(track) {
  const indexed = Boolean(track.queryIndex);
  const env = createBatchEnvironment(indexed);
  let result = env.reset();
  const simTrack = buildTrackModel(TRACK);
  const offset = simTrack.width / 2 + simTrack.kerbWidth + simTrack.gravelWidth + simTrack.runoffWidth * 0.5;
  env.resetDrivers(Object.fromEntries(DEFAULT_DRIVERS.map((driver, index) => [
    driver.id,
    {
      distanceMeters: 800 + index * 4,
      offsetMeters: simUnitsToMeters(offset),
      speedKph: 65,
      headingErrorRadians: -Math.PI / 2,
    },
  ])), { observationScope: 'reset', stateOutput: 'none' });
  const actions = Object.fromEntries(DEFAULT_DRIVERS.map((driver) => [
    driver.id,
    { steering: 0.35, throttle: 0.25, brake: 0 },
  ]));
  for (let step = 0; step < 20; step += 1) {
    result = env.step(actions);
  }
  if (!result?.observation?.[DEFAULT_DRIVERS[0].id]) {
    throw new Error('Batch environment benchmark did not return vector observations.');
  }
  const queryStats = snapshotTrackQueryStats(env.getState({ output: 'minimal' })?.snapshot?.track);
  env.destroy();
  return { queryStats };
}

const benchmarks = [
  ['nearest track states', nearestBenchmark, { iterations: 8, warmup: 1 }],
  ['pit lane states', pitBenchmark, { iterations: 8, warmup: 1 }],
  ['off-track recovery rays', rayBenchmark, { iterations: 4, warmup: 1 }],
  ['wheel surface near pit connector', wheelBenchmark, { iterations: 4, warmup: 1 }],
  ['20-car batch recovery env', batchEnvironmentBenchmark, { iterations: 3, warmup: 1 }],
];

const rows = benchmarks.flatMap(([label, fn, options]) => [
  measure(label, false, fn, options),
  measure(label, true, fn, options),
]);

setIndexEnabled(buildTrackModel(TRACK), true);

console.log('| benchmark | legacy-disabled ms/iter | indexed ms/iter | speedup |');
console.log('| --- | ---: | ---: | ---: |');
for (const [label] of benchmarks) {
  const legacy = rows.find((row) => row.label === label && row.mode === 'legacy-disabled');
  const indexed = rows.find((row) => row.label === label && row.mode === 'indexed');
  const speedup = legacy.msPerIteration / indexed.msPerIteration;
  console.log(`| ${label} | ${legacy.msPerIteration.toFixed(3)} | ${indexed.msPerIteration.toFixed(3)} | ${speedup.toFixed(2)}x |`);
}

console.log('\n| benchmark | nearest fallbacks | nearest fallback rate | nearest paths | nearest fallback reasons | pit paths | pit fallback reasons |');
console.log('| --- | ---: | ---: | --- | --- | --- | --- |');
for (const [label] of benchmarks) {
  const indexed = rows.find((row) => row.label === label && row.mode === 'indexed');
  const stats = indexed?.queryStats;
  if (!stats) {
    console.log(`| ${label} | n/a | n/a | n/a | n/a | n/a | n/a |`);
    continue;
  }
  const nearestRate = stats.nearestQueries > 0
    ? `${((stats.nearestFallbacks / stats.nearestQueries) * 100).toFixed(3)}%`
    : '0.000%';
  console.log(`| ${label} | ${stats.nearestFallbacks}/${stats.nearestQueries} | ${nearestRate} | ${formatReasonMap(stats.nearestPaths)} | ${formatReasonMap(stats.nearestFallbackReasons)} | ${formatReasonMap(stats.pitPaths)} | ${formatReasonMap(stats.pitFallbackReasons)} |`);
}

function mergeStats(left, right) {
  if (!left && !right) return null;
  if (!left) return cloneStats(right);
  if (!right) return cloneStats(left);
  return {
    nearestQueries: (left.nearestQueries ?? 0) + (right.nearestQueries ?? 0),
    nearestFallbacks: (left.nearestFallbacks ?? 0) + (right.nearestFallbacks ?? 0),
    nearestPaths: mergeMaps(left.nearestPaths, right.nearestPaths),
    nearestFallbackReasons: mergeMaps(left.nearestFallbackReasons, right.nearestFallbackReasons),
    pitQueries: (left.pitQueries ?? 0) + (right.pitQueries ?? 0),
    pitFallbacks: (left.pitFallbacks ?? 0) + (right.pitFallbacks ?? 0),
    pitPaths: mergeMaps(left.pitPaths, right.pitPaths),
    pitFallbackReasons: mergeMaps(left.pitFallbackReasons, right.pitFallbackReasons),
  };
}

function cloneStats(stats) {
  return stats ? JSON.parse(JSON.stringify(stats)) : null;
}

function mergeMaps(left = {}, right = {}) {
  const output = { ...left };
  Object.entries(right ?? {}).forEach(([key, value]) => {
    output[key] = (output[key] ?? 0) + value;
  });
  return output;
}

function formatReasonMap(map = {}) {
  const entries = Object.entries(map ?? {}).filter(([, value]) => value > 0);
  if (!entries.length) return '-';
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}:${value}`)
    .join(', ');
}
