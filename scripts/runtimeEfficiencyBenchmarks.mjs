import { createPaddockEnvironment } from '../src/environment/index.js';
import { buildRaySensors, createRayBatchContext } from '../src/environment/sensors.js';
import { renderTimingTower } from '../src/app/readouts/timingTowerRenderer.js';
import { interpolateRenderSnapshotInto } from '../src/rendering/renderSnapshot.js';
import { buildCollisionCandidatePairs, detectVehicleCollision } from '../src/simulation/collisionGeometry.js';
import { createRaceSimulation, FIXED_STEP } from '../src/simulation/raceSimulation.js';
import { TRACK, buildTrackModel, nearestTrackState, offsetTrackPoint, pointAt } from '../src/simulation/trackModel.js';
import {
  resetTrackQueryStats,
  snapshotTrackQueryStats,
} from '../src/simulation/track/trackQueryIndex.js';
import { metersToSimUnits } from '../src/simulation/units.js';
import { applyWheelSurfaceState } from '../src/simulation/vehicle/wheelSurface.js';
import {
  buildPolicyServerDecidePayload,
  buildPolicyServerResetPayload,
} from '../local-preview/src/policyRunner/controllers.js';

export const REQUIRED_RUNTIME_BENCHMARK_CATEGORIES = Object.freeze([
  'simulation',
  'simulation-phases',
  'collision',
  'track-query',
  'sensor-rays',
  'wheel-surface',
  'environment',
  'snapshots',
  'snapshot-json',
  'policy-server-json',
  'render-data',
  'dom-readouts',
]);

const PROFILES = {
  smoke: {
    simulationSteps: 18,
    collisionIterations: 24,
    trackQueryIterations: 2,
    rayIterations: 8,
    wheelIterations: 30,
    snapshotIterations: 18,
    renderIterations: 60,
    domIterations: 16,
    environmentSteps: 3,
    policyJsonIterations: 20,
  },
  standard: {
    simulationSteps: 180,
    collisionIterations: 240,
    trackQueryIterations: 12,
    rayIterations: 80,
    wheelIterations: 300,
    snapshotIterations: 140,
    renderIterations: 600,
    domIterations: 120,
    environmentSteps: 18,
    policyJsonIterations: 140,
  },
};

const BENCHMARK_DRIVERS = Array.from({ length: 20 }, (_, index) => ({
  id: `bench-${index}`,
  code: `B${index}`,
  icon: `B${index}`,
  raceName: `Bench ${index}`,
  name: `Bench Driver ${index}`,
  color: ['#e10600', '#00a3ff', '#f1c65b', '#38bdf8', '#22c55e'][index % 5],
  tire: 'M',
  pace: 1,
  racecraft: 0.8,
}));

const BENCHMARK_ENTRIES = BENCHMARK_DRIVERS.map((driver, index) => ({
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
    id: `bench-car-${index}`,
    name: `Bench Car ${index}`,
    power: 75,
    braking: 70,
    aero: 72,
    dragEfficiency: 68,
    mechanicalGrip: 74,
    weightControl: 70,
    tireCare: 70,
  },
}));

export function runRuntimeEfficiencyBenchmarks(options = {}) {
  const profileName = options.profile === 'standard' ? 'standard' : 'smoke';
  const profile = PROFILES[profileName];
  const now = typeof options.now === 'function' ? options.now : defaultNow;
  const context = createBenchmarkContext();
  const benchmarks = [
    measureBenchmark({
      name: 'simulation.step advanced field',
      category: 'simulation',
      now,
      run: () => benchmarkSimulationStep(profile),
    }),
    measureBenchmark({
      name: 'simulation phase profile',
      category: 'simulation-phases',
      now,
      run: () => benchmarkSimulationPhases(profile, now),
    }),
    measureBenchmark({
      name: 'collision candidate and narrowphase',
      category: 'collision',
      now,
      run: () => benchmarkCollision(profile),
    }),
    measureBenchmark({
      name: 'nearest track query index',
      category: 'track-query',
      now,
      run: () => benchmarkTrackQueries(context.track, profile),
    }),
    measureBenchmark({
      name: 'sensor ray road and surface channels',
      category: 'sensor-rays',
      now,
      run: () => benchmarkSensorRays(profile),
    }),
    measureBenchmark({
      name: 'wheel surface near pit connector',
      category: 'wheel-surface',
      now,
      run: () => benchmarkWheelSurface(profile),
    }),
    measureBenchmark({
      name: 'headless environment vector step',
      category: 'environment',
      now,
      run: () => benchmarkEnvironmentStep(profileName, profile),
    }),
    measureBenchmark({
      name: 'snapshot construction',
      category: 'snapshots',
      now,
      run: () => benchmarkSnapshots(profile),
    }),
    measureBenchmark({
      name: 'snapshot JSON serialization',
      category: 'snapshot-json',
      now,
      run: () => benchmarkSnapshotSerialization(profile),
    }),
    measureBenchmark({
      name: 'policy server compact JSON transport',
      category: 'policy-server-json',
      now,
      run: () => benchmarkPolicyServerJson(profile, now),
    }),
    measureBenchmark({
      name: 'render snapshot interpolation',
      category: 'render-data',
      now,
      run: () => benchmarkRenderInterpolation(profile),
    }),
    measureBenchmark({
      name: 'timing tower row markup',
      category: 'dom-readouts',
      now,
      run: () => benchmarkTimingTower(profile),
    }),
  ];

  const results = {
    profile: profileName,
    generatedAt: new Date().toISOString(),
    benchmarks,
  };
  if (options.verify !== false) validateRuntimeEfficiencyBenchmarkResults(results);
  return results;
}

export function validateRuntimeEfficiencyBenchmarkResults(results) {
  if (!results || typeof results !== 'object') {
    throw new Error('Runtime benchmark results are missing.');
  }
  if (!Array.isArray(results.benchmarks)) {
    throw new Error('Runtime benchmark results must include a benchmarks array.');
  }
  const categories = new Set(results.benchmarks.map((benchmark) => benchmark.category));
  REQUIRED_RUNTIME_BENCHMARK_CATEGORIES.forEach((category) => {
    if (!categories.has(category)) {
      throw new Error(`Runtime benchmark coverage is missing category: ${category}`);
    }
  });

  results.benchmarks.forEach((benchmark) => {
    if (!benchmark?.name || !benchmark.category) {
      throw new Error('Runtime benchmark entries must include name and category.');
    }
    if (!Number.isFinite(benchmark.totalMs) || benchmark.totalMs < 0) {
      throw new Error(`Runtime benchmark "${benchmark.name}" has an invalid duration.`);
    }
    if (!Number.isFinite(benchmark.operations) || benchmark.operations <= 0) {
      throw new Error(`Runtime benchmark "${benchmark.name}" did not execute operations.`);
    }
    if (!Number.isFinite(benchmark.msPerOperation) || benchmark.msPerOperation < 0) {
      throw new Error(`Runtime benchmark "${benchmark.name}" has an invalid per-operation duration.`);
    }
    validateBenchmarkChecks(benchmark);
  });
  return true;
}

export function formatRuntimeEfficiencyBenchmarkMarkdown(results) {
  const lines = [
    `Runtime efficiency benchmarks (${results.profile})`,
    '',
    '| category | benchmark | operations | ms/op | total ms | checks |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ];
  results.benchmarks.forEach((benchmark) => {
    lines.push(`| ${benchmark.category} | ${benchmark.name} | ${benchmark.operations} | ${benchmark.msPerOperation.toFixed(6)} | ${benchmark.totalMs.toFixed(3)} | ${formatChecks(benchmark.checks)} |`);
  });
  return `${lines.join('\n')}\n`;
}

function measureBenchmark({ name, category, run, now }) {
  const startedAt = now();
  const result = run();
  const totalMs = Math.max(0, now() - startedAt);
  const operations = Number(result.operations);
  return {
    name,
    category,
    operations,
    totalMs,
    msPerOperation: operations > 0 ? totalMs / operations : Infinity,
    checks: result.checks ?? {},
  };
}

function benchmarkSimulationStep(profile) {
  const sim = createBenchmarkSimulation({
    driverCount: 16,
    physicsMode: 'advanced',
    rules: {
      standingStart: false,
      modules: {
        pitStops: { enabled: true, variability: { enabled: false, perfect: true } },
        tireDegradation: { enabled: true },
      },
    },
  });
  const originalRecalculateRaceState = sim.recalculateRaceState.bind(sim);
  let broadRaceStateCommits = 0;
  sim.recalculateRaceState = (options) => {
    broadRaceStateCommits += 1;
    return originalRecalculateRaceState(options);
  };
  for (let index = 0; index < profile.simulationSteps; index += 1) {
    sim.step(FIXED_STEP);
  }
  const snapshot = sim.snapshotRender();
  const broadCommitsPerStep = broadRaceStateCommits / profile.simulationSteps;
  return {
    operations: profile.simulationSteps * sim.cars.length,
    checks: {
      steps: profile.simulationSteps,
      cars: sim.cars.length,
      elapsedSeconds: sim.time,
      broadRaceStateCommits,
      broadCommitsPerStep,
      renderCars: snapshot.cars.length,
      firstCarMoved: Math.abs((snapshot.cars[0]?.x ?? 0) - (snapshot.cars[0]?.previousX ?? 0)) > 0,
    },
  };
}

function benchmarkSimulationPhases(profile, now) {
  const sim = createBenchmarkSimulation({
    driverCount: 16,
    physicsMode: 'advanced',
    rules: {
      standingStart: false,
      modules: {
        pitStops: { enabled: true, variability: { enabled: false, perfect: true } },
        tireDegradation: { enabled: true },
      },
    },
  });
  const phases = new Map();
  const phaseFor = (name) => {
    if (!phases.has(name)) {
      phases.set(name, {
        calls: 0,
        totalMs: 0,
        nearestQueries: 0,
        nearestFallbacks: 0,
      });
    }
    return phases.get(name);
  };
  sim.runtimeProfiler = {
    measure(name, run) {
      const beforeStats = snapshotTrackQueryStats(sim.track);
      const startedAt = now();
      const result = run();
      const totalMs = Math.max(0, now() - startedAt);
      const afterStats = snapshotTrackQueryStats(sim.track);
      const phase = phaseFor(name);
      phase.calls += 1;
      phase.totalMs += totalMs;
      phase.nearestQueries += Math.max(0, (afterStats?.nearestQueries ?? 0) - (beforeStats?.nearestQueries ?? 0));
      phase.nearestFallbacks += Math.max(0, (afterStats?.nearestFallbacks ?? 0) - (beforeStats?.nearestFallbacks ?? 0));
      return result;
    },
  };

  resetTrackQueryStats(sim.track);
  for (let index = 0; index < profile.simulationSteps; index += 1) {
    sim.step(FIXED_STEP);
  }
  sim.runtimeProfiler = null;

  const phaseEntries = Object.fromEntries([...phases.entries()].map(([name, phase]) => [name, {
    calls: phase.calls,
    totalMs: Number(phase.totalMs.toFixed(6)),
    msPerCall: Number((phase.totalMs / Math.max(1, phase.calls)).toFixed(6)),
    nearestQueries: phase.nearestQueries,
    nearestFallbacks: phase.nearestFallbacks,
  }]));

  return {
    operations: profile.simulationSteps,
    checks: {
      steps: profile.simulationSteps,
      phaseNames: Object.keys(phaseEntries),
      phases: phaseEntries,
      prePhysicsNearestQueries: phaseEntries.prePhysicsWheelSurface?.nearestQueries ?? 0,
      runoffNearestQueries: phaseEntries.runoffResponse?.nearestQueries ?? 0,
      localRefreshNearestQueries: phaseEntries.localSurfaceRefresh?.nearestQueries ?? 0,
      broadCommitNearestQueries: phaseEntries.broadRaceCommit?.nearestQueries ?? 0,
      broadCommitCalls: phaseEntries.broadRaceCommit?.calls ?? 0,
    },
  };
}

function benchmarkCollision(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 4, physicsMode: 'advanced' });
  const base = pointAt(sim.track, metersToSimUnits(800));
  sim.cars.forEach((car, index) => {
    sim.setCarState(car.id, {
      x: base.x + index * 1.5,
      y: base.y,
      previousX: base.x + index * 1.5,
      previousY: base.y,
      heading: base.heading,
      speed: 35,
      progress: base.distance + index,
      raceDistance: base.distance + index,
    });
  });

  let candidatePairs = 0;
  let collisions = 0;
  const scratch = {};
  let reusedCandidateArray = true;
  let previousCandidates = null;
  for (let iteration = 0; iteration < profile.collisionIterations; iteration += 1) {
    const candidates = buildCollisionCandidatePairs(sim.cars, {
      trackLength: sim.track.length,
      scratch,
    });
    if (previousCandidates && candidates !== previousCandidates) reusedCandidateArray = false;
    previousCandidates = candidates;
    candidatePairs += candidates.length;
    candidates.forEach(([first, second]) => {
      if (detectVehicleCollision(first, second)) collisions += 1;
    });
  }
  return {
    operations: Math.max(1, candidatePairs),
    checks: {
      iterations: profile.collisionIterations,
      candidatePairs,
      collisions,
      reusedCandidateArray,
    },
  };
}

function benchmarkTrackQueries(track, profile) {
  const queries = precomputeNearestQueries(track);
  resetTrackQueryStats(track);
  for (let iteration = 0; iteration < profile.trackQueryIterations; iteration += 1) {
    queries.forEach(({ position, progressHint }) => {
      nearestTrackState(track, position, progressHint, { allowPitOverride: false });
    });
  }
  const stats = snapshotTrackQueryStats(track);
  return {
    operations: queries.length * profile.trackQueryIterations,
    checks: {
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      queryPoints: queries.length,
    },
  };
}

function benchmarkSensorRays(profile) {
  const sim = createBenchmarkSimulation({
    driverCount: 4,
    physicsMode: 'advanced',
    participantInteractions: { defaultProfile: 'batch-training' },
    rules: {
      standingStart: false,
      modules: {
        pitStops: { enabled: false },
        tireDegradation: { enabled: false },
      },
    },
  });
  const snapshot = sim.snapshotObservation();
  const center = pointAt(snapshot.track, metersToSimUnits(900));
  const offset = snapshot.track.width / 2 +
    snapshot.track.kerbWidth +
    snapshot.track.gravelWidth +
    snapshot.track.runoffWidth +
    metersToSimUnits(38);
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
  const rayOptions = {
    rays: [
      { id: 'front-left', angleDegrees: -42, lengthMeters: 220 },
      { id: 'front', angleDegrees: 0, lengthMeters: 260 },
      { id: 'front-right', angleDegrees: 42, lengthMeters: 220 },
      { id: 'rear', angleDegrees: 180, lengthMeters: 160 },
    ],
    channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
    precision: 'driver',
  };

  resetTrackQueryStats(snapshot.track);
  let rayCount = 0;
  let hitCount = 0;
  let firstRays = null;
  let rayContainersReused = true;
  const batchContext = {
    ...createRayBatchContext(snapshot),
    scratch: {},
  };
  for (let iteration = 0; iteration < profile.rayIterations; iteration += 1) {
    const rays = buildRaySensors(car, snapshot, rayOptions, batchContext);
    if (!firstRays) {
      firstRays = rays;
    } else if (
      rays !== firstRays ||
      rays.length !== firstRays.length ||
      rays.some((ray, index) => ray !== firstRays[index])
    ) {
      rayContainersReused = false;
    }
    rayCount += rays.length;
    hitCount += rays.filter((ray) => ray.roadEdge.hit || ray.kerb.hit || ray.illegalSurface.hit || ray.car.hit).length;
  }
  const stats = snapshotTrackQueryStats(snapshot.track);
  return {
    operations: rayCount,
    checks: {
      rayCount,
      hitCount,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      rayContainersReused,
    },
  };
}

function benchmarkWheelSurface(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 1, physicsMode: 'advanced' });
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

  resetTrackQueryStats(sim.track);
  let fullSamples = 0;
  let firstWheelStates = null;
  let wheelContainersReused = true;
  for (let iteration = 0; iteration < profile.wheelIterations; iteration += 1) {
    car.wheelSurfaceCache = null;
    const result = applyWheelSurfaceState(car, sim.track);
    if (result.sampleMode === 'full') fullSamples += 1;
    if (!firstWheelStates) {
      firstWheelStates = car.wheelStates;
    } else if (
      car.wheelStates !== firstWheelStates ||
      car.wheelStates.length !== firstWheelStates.length ||
      car.wheelStates.some((wheel, index) => wheel !== firstWheelStates[index])
    ) {
      wheelContainersReused = false;
    }
  }
  const stats = snapshotTrackQueryStats(sim.track);
  return {
    operations: profile.wheelIterations,
    checks: {
      wheelIterations: profile.wheelIterations,
      fullSamples,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      wheelContainersReused,
    },
  };
}

function benchmarkEnvironmentStep(profileName, profile) {
  const env = createRuntimeBenchmarkEnvironment({
    profile: profileName,
    driverCount: profileName === 'smoke' ? 6 : 20,
    frameSkip: 4,
  });
  let result = env.reset();
  const ids = result.info.controlledDrivers;
  const actions = Object.fromEntries(ids.map((driverId) => [
    driverId,
    { steering: 0.25, throttle: 0.35, brake: 0 },
  ]));
  for (let step = 0; step < profile.environmentSteps; step += 1) {
    result = env.step(actions);
  }
  const vectorLengths = ids.map((driverId) => result.observation?.[driverId]?.vector?.length ?? 0);
  env.destroy();
  return {
    operations: profile.environmentSteps * ids.length * 4,
    checks: {
      steps: profile.environmentSteps,
      controlledDrivers: ids.length,
      vectorObservations: vectorLengths.filter((length) => length > 0).length,
      minVectorLength: Math.min(...vectorLengths),
      stateIsNull: result.state === null,
    },
  };
}

function benchmarkSnapshots(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 12, physicsMode: 'advanced' });
  for (let index = 0; index < 12; index += 1) sim.step(FIXED_STEP);

  let fullSnapshots = 0;
  let renderSnapshots = 0;
  let observationSnapshots = 0;
  let trainingSnapshots = 0;
  for (let iteration = 0; iteration < profile.snapshotIterations; iteration += 1) {
    if (sim.snapshot()) fullSnapshots += 1;
    if (sim.snapshotRender()) renderSnapshots += 1;
    if (sim.snapshotObservation()) observationSnapshots += 1;
    if (sim.snapshotTraining()) trainingSnapshots += 1;
  }
  const render = sim.snapshotRender();
  return {
    operations: profile.snapshotIterations * 4,
    checks: {
      fullSnapshots,
      renderSnapshots,
      observationSnapshots,
      trainingSnapshots,
      renderCars: render.cars.length,
      renderCarHasSetup: Object.hasOwn(render.cars[0] ?? {}, 'setup'),
    },
  };
}

function benchmarkSnapshotSerialization(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 12, physicsMode: 'advanced' });
  for (let index = 0; index < 12; index += 1) sim.step(FIXED_STEP);
  const full = sim.snapshot();
  const render = sim.snapshotRender();
  const observation = sim.snapshotObservation();
  const training = sim.snapshotTraining();
  let fullBytes = 0;
  let renderBytes = 0;
  let observationBytes = 0;
  let trainingBytes = 0;
  for (let iteration = 0; iteration < profile.snapshotIterations; iteration += 1) {
    fullBytes += JSON.stringify(full).length;
    renderBytes += JSON.stringify(render).length;
    observationBytes += JSON.stringify(observation).length;
    trainingBytes += JSON.stringify(training).length;
  }
  return {
    operations: profile.snapshotIterations * 4,
    checks: {
      fullBytes,
      renderBytes,
      observationBytes,
      trainingBytes,
      renderIsLeaner: renderBytes < fullBytes,
    },
  };
}

function benchmarkPolicyServerJson(profile, now) {
  const env = createRuntimeBenchmarkEnvironment({
    driverCount: 12,
    frameSkip: 1,
    observation: { profile: 'default', output: 'full', includeSchema: true },
    result: { stateOutput: 'none' },
    sensors: {
      rays: {
        enabled: true,
        layout: 'driver-front-heavy',
        channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
      },
      nearbyCars: { enabled: true, maxCars: 6, radiusMeters: 150 },
    },
  });
  let result = env.reset();
  const driverIds = result.info.controlledDrivers;
  const actions = Object.fromEntries(driverIds.map((driverId) => [
    driverId,
    { steering: 0.18, throttle: 0.55, brake: 0 },
  ]));
  for (let step = 0; step < 4; step += 1) result = env.step(actions);

  const context = {
    controlledDrivers: driverIds,
    actionSpec: env.getActionSpec(),
    observationSpec: env.getObservationSpec(),
    observation: result.observation,
    previousActions: actions,
    metrics: result.metrics,
    events: result.events,
    configuration: { benchmark: 'policy-server-json' },
  };
  const richPayload = {
    driverIds,
    observations: result.observation,
    previousActions: actions,
    metrics: result.metrics,
    events: result.events,
    actionSpec: context.actionSpec,
    observationSpec: context.observationSpec,
  };
  const compactPayload = buildPolicyServerDecidePayload(context);
  const resetPayload = buildPolicyServerResetPayload(context);

  let richBytes = 0;
  let compactBytes = 0;
  let resetBytes = 0;
  const richStartedAt = now();
  for (let iteration = 0; iteration < profile.policyJsonIterations; iteration += 1) {
    richBytes += JSON.stringify(richPayload).length;
  }
  const richStringifyMs = now() - richStartedAt;
  const compactStartedAt = now();
  for (let iteration = 0; iteration < profile.policyJsonIterations; iteration += 1) {
    compactBytes += JSON.stringify(compactPayload).length;
  }
  const compactStringifyMs = now() - compactStartedAt;
  resetBytes = JSON.stringify(resetPayload).length;
  env.destroy();

  const byteReductionRatio = ratioReduction(richBytes, compactBytes);
  const stringifyReductionRatio = ratioReduction(richStringifyMs, compactStringifyMs);
  return {
    operations: profile.policyJsonIterations * driverIds.length,
    checks: {
      iterations: profile.policyJsonIterations,
      drivers: driverIds.length,
      richBytes,
      compactBytes,
      resetBytes,
      byteReductionRatio,
      richStringifyMs,
      compactStringifyMs,
      stringifyReductionRatio,
      compactHasVectors: Boolean(compactPayload.vectors && !compactPayload.observations),
      compactRepeatsSpecs: Object.hasOwn(compactPayload, 'observationSpec') || Object.hasOwn(compactPayload, 'actionSpec'),
      resetHasSpecs: Object.hasOwn(resetPayload, 'observationSpec') && Object.hasOwn(resetPayload, 'actionSpec'),
    },
  };
}

function benchmarkRenderInterpolation(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 14, physicsMode: 'advanced' });
  sim.step(FIXED_STEP);
  const snapshot = sim.snapshotRender();
  const buffer = {};
  let reusedCars = true;
  let previousCars = null;
  for (let iteration = 0; iteration < profile.renderIterations; iteration += 1) {
    const renderSnapshot = interpolateRenderSnapshotInto(buffer, snapshot, (iteration % 10) / 10);
    if (previousCars && renderSnapshot.cars !== previousCars) reusedCars = false;
    previousCars = renderSnapshot.cars;
  }
  return {
    operations: profile.renderIterations * snapshot.cars.length,
    checks: {
      iterations: profile.renderIterations,
      cars: snapshot.cars.length,
      bufferReused: previousCars === buffer.cars,
      carArrayReused: reusedCars,
    },
  };
}

function ratioReduction(before, after) {
  if (!Number.isFinite(before) || before <= 0) return 0;
  return Math.max(0, (before - after) / before);
}

function benchmarkTimingTower(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 20, physicsMode: 'arcade' });
  for (let index = 0; index < 8; index += 1) sim.step(FIXED_STEP);
  const snapshot = sim.snapshot();
  const driverById = new Map(BENCHMARK_DRIVERS.map((driver) => [driver.id, driver]));
  const timingList = createMockTimingList();
  let lastTimingMarkup = '';
  let firstRows = null;
  let rowNodesReused = true;

  for (let iteration = 0; iteration < profile.domIterations; iteration += 1) {
    lastTimingMarkup = renderTimingTower({
      timingList,
      cars: snapshot.cars,
      raceMode: snapshot.raceControl.mode,
      penalties: snapshot.penalties,
      driverById,
      selectedId: snapshot.cars[iteration % snapshot.cars.length]?.id,
      timingGapMode: iteration % 2 === 0 ? 'interval' : 'leader',
      timingPenaltyBadgesEnabled: true,
      lastTimingMarkup,
    });
    const currentRows = [...timingList.children];
    if (!firstRows) {
      firstRows = currentRows;
    } else if (
      currentRows.length !== firstRows.length ||
      currentRows.some((row, index) => row !== firstRows[index])
    ) {
      rowNodesReused = false;
    }
  }

  return {
    operations: profile.domIterations * snapshot.cars.length,
    checks: {
      rows: snapshot.cars.length,
      htmlLength: timingList.innerHTML.length,
      innerHTMLAssignments: timingList.assignments,
      rowNodesReused,
    },
  };
}

function createBenchmarkContext() {
  return {
    track: buildTrackModel({
      ...TRACK,
      centerlineControls: TRACK.centerlineControls?.map((control) => ({ ...control })),
      drsZones: TRACK.drsZones?.map((zone) => ({ ...zone })),
    }),
  };
}

function createBenchmarkSimulation(options = {}) {
  return createRaceSimulation({
    drivers: BENCHMARK_DRIVERS.slice(0, options.driverCount ?? 12),
    entries: BENCHMARK_ENTRIES,
    track: TRACK,
    seed: 71,
    physicsMode: options.physicsMode ?? 'arcade',
    participantInteractions: options.participantInteractions,
    rules: {
      standingStart: false,
      ...(options.rules ?? {}),
    },
  });
}

function precomputeNearestQueries(track) {
  const offsets = [
    0,
    track.width * 0.48,
    track.width / 2 + track.kerbWidth * 0.5,
    track.width / 2 + track.kerbWidth + track.gravelWidth * 0.55,
    track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth * 0.65,
  ];
  return Array.from({ length: 240 }, (_, index) => {
    const distance = (track.length * index) / 240;
    const center = pointAt(track, distance);
    return offsets.map((offset) => ({
      position: offsetTrackPoint(center, offset),
      progressHint: center.distance,
    }));
  }).flat();
}

class BenchmarkDocument {
  createElement(tagName) {
    return new BenchmarkElement(tagName, this);
  }
}

class BenchmarkElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.parentNode = null;
    this.className = '';
    this.textContent = '';
    this.assignments = 0;
    this.value = '';
    this.style = {
      values: new Map(),
      setProperty: (name, value) => {
        this.style.values.set(name, String(value));
      },
    };
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }

  get innerHTML() {
    if (this.children.length === 0) return this.value;
    return this.children.map((child) => child.outerHTML).join('');
  }

  set innerHTML(nextValue) {
    this.assignments += 1;
    this.value = String(nextValue);
    this.children.length = 0;
  }

  get outerHTML() {
    const attributes = [];
    if (this.className) attributes.push(`class="${this.className}"`);
    this.attributes.forEach((value, name) => {
      if (name !== 'class') attributes.push(`${name}="${value}"`);
    });
    if (this.style.values.size) {
      attributes.push(`style="${[...this.style.values.entries()].map(([name, value]) => `${name}: ${value}`).join('; ')}"`);
    }
    return `<${this.tagName}${attributes.length ? ` ${attributes.join(' ')}` : ''}>${this.textContent}${this.children.map((child) => child.outerHTML).join('')}</${this.tagName}>`;
  }
}

function createMockTimingList() {
  return new BenchmarkDocument().createElement('ol');
}

function validateBenchmarkChecks(benchmark) {
  const checks = benchmark.checks ?? {};
  if (benchmark.category === 'simulation') {
    requirePositive(checks.steps, benchmark, 'steps');
    requirePositive(checks.cars, benchmark, 'cars');
    requirePositive(checks.elapsedSeconds, benchmark, 'elapsedSeconds');
    requireEqual(checks.broadCommitsPerStep, 1, benchmark, 'broadCommitsPerStep');
  } else if (benchmark.category === 'simulation-phases') {
    requirePositive(checks.steps, benchmark, 'steps');
    requirePhase(checks, benchmark, 'prePhysicsWheelSurface');
    requirePhase(checks, benchmark, 'runoffResponse');
    requirePhase(checks, benchmark, 'localSurfaceRefresh');
    requirePhase(checks, benchmark, 'broadRaceCommit');
    requireEqual(checks.broadCommitCalls, checks.steps, benchmark, 'broadCommitCalls');
    requireEqual(checks.broadCommitNearestQueries, 0, benchmark, 'broadCommitNearestQueries');
  } else if (benchmark.category === 'collision') {
    requirePositive(checks.candidatePairs, benchmark, 'candidatePairs');
    requirePositive(checks.collisions, benchmark, 'collisions');
    requireTrue(checks.reusedCandidateArray, benchmark, 'reusedCandidateArray');
  } else if (benchmark.category === 'track-query') {
    requirePositive(checks.nearestQueries, benchmark, 'nearestQueries');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
  } else if (benchmark.category === 'sensor-rays') {
    requirePositive(checks.rayCount, benchmark, 'rayCount');
    requirePositive(checks.hitCount, benchmark, 'hitCount');
    requirePositive(checks.nearestQueries, benchmark, 'nearestQueries');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
    requireTrue(checks.rayContainersReused, benchmark, 'rayContainersReused');
  } else if (benchmark.category === 'wheel-surface') {
    requirePositive(checks.wheelIterations, benchmark, 'wheelIterations');
    requirePositive(checks.nearestQueries, benchmark, 'nearestQueries');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
    requireTrue(checks.wheelContainersReused, benchmark, 'wheelContainersReused');
  } else if (benchmark.category === 'environment') {
    requirePositive(checks.steps, benchmark, 'steps');
    requirePositive(checks.controlledDrivers, benchmark, 'controlledDrivers');
    requireEqual(checks.vectorObservations, checks.controlledDrivers, benchmark, 'vectorObservations');
    requirePositive(checks.minVectorLength, benchmark, 'minVectorLength');
    requireTrue(checks.stateIsNull, benchmark, 'stateIsNull');
  } else if (benchmark.category === 'snapshots') {
    requirePositive(checks.fullSnapshots, benchmark, 'fullSnapshots');
    requirePositive(checks.renderSnapshots, benchmark, 'renderSnapshots');
    requirePositive(checks.observationSnapshots, benchmark, 'observationSnapshots');
    requirePositive(checks.trainingSnapshots, benchmark, 'trainingSnapshots');
    requireEqual(checks.renderCarHasSetup, false, benchmark, 'renderCarHasSetup');
  } else if (benchmark.category === 'snapshot-json') {
    requirePositive(checks.fullBytes, benchmark, 'fullBytes');
    requirePositive(checks.renderBytes, benchmark, 'renderBytes');
    requireTrue(checks.renderIsLeaner, benchmark, 'renderIsLeaner');
  } else if (benchmark.category === 'policy-server-json') {
    requirePositive(checks.richBytes, benchmark, 'richBytes');
    requirePositive(checks.compactBytes, benchmark, 'compactBytes');
    requireAtLeast(checks.byteReductionRatio, 0.6, benchmark, 'byteReductionRatio');
    requirePositive(checks.richStringifyMs, benchmark, 'richStringifyMs');
    requireAtLeast(checks.stringifyReductionRatio, 0.5, benchmark, 'stringifyReductionRatio');
    requireTrue(checks.compactHasVectors, benchmark, 'compactHasVectors');
    requireEqual(checks.compactRepeatsSpecs, false, benchmark, 'compactRepeatsSpecs');
    requireTrue(checks.resetHasSpecs, benchmark, 'resetHasSpecs');
  } else if (benchmark.category === 'render-data') {
    requirePositive(checks.iterations, benchmark, 'iterations');
    requireTrue(checks.bufferReused, benchmark, 'bufferReused');
    requireTrue(checks.carArrayReused, benchmark, 'carArrayReused');
  } else if (benchmark.category === 'dom-readouts') {
    requirePositive(checks.rows, benchmark, 'rows');
    requirePositive(checks.htmlLength, benchmark, 'htmlLength');
    requireEqual(checks.innerHTMLAssignments, 0, benchmark, 'innerHTMLAssignments');
    requireTrue(checks.rowNodesReused, benchmark, 'rowNodesReused');
  }
}

function requirePhase(checks, benchmark, phaseName) {
  const phase = checks.phases?.[phaseName];
  if (!phase || !Number.isFinite(phase.calls) || phase.calls <= 0) {
    throw new Error(`Runtime benchmark "${benchmark.name}" did not profile phase ${phaseName}.`);
  }
  requireEqual(phase.nearestFallbacks, 0, benchmark, `${phaseName}.nearestFallbacks`);
}

function requirePositive(value, benchmark, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Runtime benchmark "${benchmark.name}" did not exercise ${label}.`);
  }
}

function requireEqual(value, expected, benchmark, label) {
  if (value !== expected) {
    throw new Error(`Runtime benchmark "${benchmark.name}" expected ${label}=${expected}, received ${value}.`);
  }
}

function requireAtLeast(value, minimum, benchmark, label) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`Runtime benchmark "${benchmark.name}" expected ${label}>=${minimum}, received ${value}.`);
  }
}

function requireTrue(value, benchmark, label) {
  if (value !== true) {
    throw new Error(`Runtime benchmark "${benchmark.name}" failed check ${label}.`);
  }
}

function formatChecks(checks = {}) {
  return Object.entries(checks)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(', ');
}

function formatValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  if (Array.isArray(value)) return value.join('/');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function createRuntimeBenchmarkEnvironment(options = {}) {
  const driverCount = options.driverCount ?? 20;
  const drivers = BENCHMARK_DRIVERS.slice(0, driverCount);
  const ids = drivers.map((driver) => driver.id);
  return createPaddockEnvironment({
    drivers,
    entries: BENCHMARK_ENTRIES,
    controlledDrivers: ids,
    seed: 71,
    track: TRACK,
    physicsMode: 'advanced',
    frameSkip: options.frameSkip ?? 4,
    participantInteractions: { defaultProfile: 'batch-training' },
    scenario: { participants: ids },
    observation: options.observation ?? { profile: 'physical-driver', output: 'vector', includeSchema: false },
    result: options.result ?? { stateOutput: 'none' },
    sensors: options.sensors ?? {
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
