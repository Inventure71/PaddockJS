import { createPaddockEnvironment } from '../src/environment/index.js';
import { buildDriverMetrics } from '../src/environment/metrics.js';
import { buildEnvironmentObservation } from '../src/environment/observations.js';
import { buildRaySensors, createRayBatchContext } from '../src/environment/sensors/index.js';
import { traceIndexedRayBands } from '../src/environment/sensors/rayBandTrace.js';
import { renderTimingTower } from '../src/app/readouts/timingTowerRenderer.js';
import { interpolateRenderSnapshotInto } from '../src/rendering/renderSnapshot.js';
import { buildCollisionCandidatePairs, detectVehicleCollision } from '../src/simulation/collisionGeometry.js';
import { createRaceSimulation, FIXED_STEP } from '../src/simulation/raceSimulation.js';
import { TRACK, buildTrackModel, nearestTrackState, offsetTrackPoint, pointAt } from '../src/simulation/track/trackModel.js';
import { nearestPitLaneState } from '../src/simulation/track/pitLaneState.js';
import {
  queryHintedTrackProjection,
  resetTrackQueryStats,
  snapshotTrackQueryStats,
} from '../src/simulation/track/trackQueryIndex.js';
import { queryRunoffTrackStateForCar } from '../src/simulation/track/trackStatePolicy.js';
import { metersToSimUnits } from '../src/simulation/units.js';
import { TIMING_HISTORY_MAX_SAMPLES, TIMING_LINE_HISTORY_LAPS } from '../src/simulation/timing/timingConstants.js';
import { estimateTimingLineGapSeconds } from '../src/simulation/timing/gapEstimation.js';
import { interpolateTimeAtDistance, recordTimingSample } from '../src/simulation/timing/timingHistory.js';
import { recordTimingLineCrossings } from '../src/simulation/timing/timingLines.js';
import { updateLapTelemetry } from '../src/simulation/timing/raceTiming.js';
import { applyContactVelocityResponse, resolveCollisionsForSimulation } from '../src/simulation/vehicle/contactResolution.js';
import { applyWheelSurfaceState, calculateWheelSurfaceState } from '../src/simulation/vehicle/wheelSurface.js';
import {
  createRoute,
  distanceToNextLimiterSegment,
  nearestDistanceOnRoute,
  routeLimiterActiveAt,
  sampleRouteInto,
} from '../src/simulation/pit/pitRouting.js';
import {
  buildPolicyServerDecidePayload,
  buildPolicyServerResetPayload,
} from '../local-preview/src/policyRunner/controllers.js';

export const REQUIRED_RUNTIME_BENCHMARK_CATEGORIES = Object.freeze([
  'simulation',
  'simulation-phases',
  'pit-lane-transition',
  'collision',
  'track-query',
  'sensor-rays',
  'sensor-surface-rays',
  'sensor-ray-bands',
  'sensor-ray-recovery',
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
    pitRouteIterations: 300,
    timingMaintenanceSteps: 600,
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
    pitRouteIterations: 6000,
    timingMaintenanceSteps: 5000,
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
      name: 'simulation.step arcade field',
      category: 'simulation',
      now,
      run: () => benchmarkSimulationStep(profile, 'arcade'),
    }),
    measureBenchmark({
      name: 'simulation phase profile',
      category: 'simulation-phases',
      now,
      run: () => benchmarkSimulationPhases(profile, now),
    }),
    measureBenchmark({
      name: 'timing history and line maintenance',
      category: 'simulation-phases',
      now,
      run: () => benchmarkTimingMaintenance(profile),
    }),
    measureBenchmark({
      name: 'timing-line gap without stored crossings',
      category: 'simulation-phases',
      now,
      run: () => benchmarkTimingLineGapWithoutStoredCrossings(profile),
    }),
    measureBenchmark({
      name: 'lap telemetry in-progress sync',
      category: 'simulation-phases',
      now,
      run: () => benchmarkLapTelemetryInProgress(profile),
    }),
    measureBenchmark({
      name: 'pit route transition geometry',
      category: 'pit-lane-transition',
      now,
      run: () => benchmarkPitRouteTransition(profile),
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
      name: 'batch-training sensor surface channels',
      category: 'sensor-surface-rays',
      now,
      run: () => benchmarkBatchTrainingSurfaceRays(profile),
    }),
    measureBenchmark({
      name: 'sensor ray barrier illegal-surface validation',
      category: 'sensor-ray-bands',
      now,
      run: () => benchmarkBarrierIllegalSurfaceValidation(profile),
    }),
    measureBenchmark({
      name: 'sensor ray barrier off-track recovery',
      category: 'sensor-ray-recovery',
      now,
      run: () => benchmarkSampledRecoverySensorRay(profile),
    }),
    measureBenchmark({
      name: 'sensor ray pit-lane direct boundary',
      category: 'sensor-ray-recovery',
      now,
      run: () => benchmarkPitLaneDirectBoundarySensorRay(profile),
    }),
    measureBenchmark({
      name: 'wheel surface near pit connector',
      category: 'wheel-surface',
      now,
      run: () => benchmarkWheelSurface(profile),
    }),
    measureBenchmark({
      name: 'wheel surface connector local-refresh path',
      category: 'wheel-surface',
      now,
      run: () => benchmarkConnectorLocalRefreshWheelSurface(profile),
    }),
    measureBenchmark({
      name: 'wheel surface main-track analytic',
      category: 'wheel-surface',
      now,
      run: () => benchmarkMainTrackWheelSurface(profile),
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

function benchmarkSimulationStep(profile, physicsMode = 'advanced') {
  const sim = createBenchmarkSimulation({
    driverCount: 16,
    physicsMode,
    rules: {
      standingStart: false,
      modules: {
        pitStops: { enabled: true, variability: { enabled: false, perfect: true } },
        tireDegradation: { enabled: true },
      },
    },
  });
  const originalRecalculateRaceState = sim.recalculateRaceState.bind(sim);
  const originalGetDrsReferenceCar = sim.getDrsReferenceCar.bind(sim);
  const originalComputeAggression = sim.computeAggression.bind(sim);
  const originalOrderedCars = sim.orderedCars.bind(sim);
  const originalEvaluateRaceFinish = sim.evaluateRaceFinish.bind(sim);
  let broadRaceStateCommits = 0;
  let broadCommitSurfaceRefreshSkips = 0;
  let broadCommitDrsFieldScans = 0;
  let broadCommitAggressionFieldScans = 0;
  let broadCommitFinishEvalOrderedScans = 0;
  let insideFinishEval = false;
  const telemetry = sim.cars[0]?.lapTelemetry ?? null;
  sim.runtimeBenchmarkStats = {};
  const telemetryRefs = telemetry ? {
    telemetry,
    currentSectors: telemetry.currentSectors,
    sectorProgress: telemetry.sectorProgress,
    liveSectors: telemetry.liveSectors,
    lastSectors: telemetry.lastSectors,
    sectorPerformance: telemetry.sectorPerformance,
    sectorPerformanceCurrent: telemetry.sectorPerformance?.current,
    sectorPerformanceLast: telemetry.sectorPerformance?.last,
    sectorPerformanceBest: telemetry.sectorPerformance?.best,
  } : null;
  sim.recalculateRaceState = (options) => {
    broadRaceStateCommits += 1;
    if (options?.refreshSurfaces === false) broadCommitSurfaceRefreshSkips += 1;
    return originalRecalculateRaceState(options);
  };
  sim.getDrsReferenceCar = (car) => {
    broadCommitDrsFieldScans += 1;
    return originalGetDrsReferenceCar(car);
  };
  sim.computeAggression = (car, orderIndex, fieldDepth) => {
    if (!Number.isFinite(fieldDepth)) broadCommitAggressionFieldScans += 1;
    return originalComputeAggression(car, orderIndex, fieldDepth);
  };
  sim.orderedCars = () => {
    if (insideFinishEval) broadCommitFinishEvalOrderedScans += 1;
    return originalOrderedCars();
  };
  sim.evaluateRaceFinish = (orderedCars) => {
    insideFinishEval = true;
    try {
      return originalEvaluateRaceFinish(orderedCars);
    } finally {
      insideFinishEval = false;
    }
  };
  for (let index = 0; index < profile.simulationSteps; index += 1) {
    sim.step(FIXED_STEP);
  }
  const snapshot = sim.snapshotRender();
  const broadCommitsPerStep = broadRaceStateCommits / profile.simulationSteps;
  const telemetryBuffersReused = telemetryRefs
    ? sim.cars[0]?.lapTelemetry === telemetryRefs.telemetry
      && sim.cars[0]?.lapTelemetry?.currentSectors === telemetryRefs.currentSectors
      && sim.cars[0]?.lapTelemetry?.sectorProgress === telemetryRefs.sectorProgress
      && sim.cars[0]?.lapTelemetry?.liveSectors === telemetryRefs.liveSectors
      && sim.cars[0]?.lapTelemetry?.lastSectors === telemetryRefs.lastSectors
      && sim.cars[0]?.lapTelemetry?.sectorPerformance === telemetryRefs.sectorPerformance
      && sim.cars[0]?.lapTelemetry?.sectorPerformance?.current === telemetryRefs.sectorPerformanceCurrent
      && sim.cars[0]?.lapTelemetry?.sectorPerformance?.last === telemetryRefs.sectorPerformanceLast
      && sim.cars[0]?.lapTelemetry?.sectorPerformance?.best === telemetryRefs.sectorPerformanceBest
    : false;
  return {
    operations: profile.simulationSteps * sim.cars.length,
    checks: {
      steps: profile.simulationSteps,
      cars: sim.cars.length,
      elapsedSeconds: sim.time,
      broadRaceStateCommits,
      broadCommitsPerStep,
      broadCommitSurfaceRefreshSkips,
      broadCommitDrsFieldScans,
      broadCommitDrsReferenceScratchBuilds: sim.runtimeBenchmarkStats.drsReferenceScratchBuilds ?? 0,
      broadCommitDrsReferenceFullFieldFastPathCalls: sim.runtimeBenchmarkStats.drsReferenceFullFieldFastPathCalls ?? 0,
      broadCommitDrsReferenceOrderedFastPathCalls: sim.runtimeBenchmarkStats.drsReferenceOrderedFastPathCalls ?? 0,
      broadCommitDrsNextZoneScans: sim.runtimeBenchmarkStats.drsNextZoneScans ?? 0,
      broadCommitDrsNextZoneCacheHits: sim.runtimeBenchmarkStats.drsNextZoneCacheHits ?? 0,
      broadCommitDrsNextZoneFastPathChecks: sim.runtimeBenchmarkStats.drsNextZoneFastPathChecks ?? 0,
      broadCommitAggressionFieldScans,
      broadCommitFinishEvalOrderedScans,
      broadCommitFinishEvalNoFinishFastPathCalls: sim.runtimeBenchmarkStats.finishEvalNoFinishFastPathCalls ?? 0,
      broadCommitExcludedCarResetScans: sim.runtimeBenchmarkStats.excludedCarResetScans ?? 0,
      broadCommitExcludedCarResetSkips: sim.runtimeBenchmarkStats.excludedCarResetSkips ?? 0,
      broadCommitTimingStateUpdates: sim.runtimeBenchmarkStats.timingStateUpdates ?? 0,
      broadCommitLeaderGapAccumulated: sim.runtimeBenchmarkStats.leaderGapAccumulated ?? 0,
      broadCommitLeaderGapFallbackEstimates: sim.runtimeBenchmarkStats.leaderGapFallbackEstimates ?? 0,
      sectorPerformanceDirtyCommits: sim.runtimeBenchmarkStats.sectorPerformanceDirtyCommits ?? 0,
      sectorPerformanceRebuilds: sim.runtimeBenchmarkStats.sectorPerformanceRebuilds ?? 0,
      sectorPerformanceSkippedRebuilds: sim.runtimeBenchmarkStats.sectorPerformanceSkippedRebuilds ?? 0,
      sectorPerformanceChangedCars: sim.runtimeBenchmarkStats.sectorPerformanceChangedCars ?? 0,
      sectorPerformanceUpdatedCars: sim.runtimeBenchmarkStats.sectorPerformanceUpdatedCars ?? 0,
      sectorPerformanceOverallBestChanges: sim.runtimeBenchmarkStats.sectorPerformanceOverallBestChanges ?? 0,
      telemetryBuffersReused,
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
        hintedArcQueries: 0,
        segmentNeighborhoodQueries: 0,
        segmentNeighborhoodBatchCalls: 0,
        runoffRadius1Queries: 0,
        runoffRadius2Queries: 0,
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
      phase.hintedArcQueries += Math.max(0, (afterStats?.hintedArcQueries ?? 0) - (beforeStats?.hintedArcQueries ?? 0));
      phase.segmentNeighborhoodQueries += Math.max(0, (afterStats?.segmentNeighborhoodQueries ?? 0) - (beforeStats?.segmentNeighborhoodQueries ?? 0));
      phase.segmentNeighborhoodBatchCalls += Math.max(0, (afterStats?.segmentNeighborhoodBatchCalls ?? 0) - (beforeStats?.segmentNeighborhoodBatchCalls ?? 0));
      phase.runoffRadius1Queries += Math.max(0, (afterStats?.runoffRadius1Queries ?? 0) - (beforeStats?.runoffRadius1Queries ?? 0));
      phase.runoffRadius2Queries += Math.max(0, (afterStats?.runoffRadius2Queries ?? 0) - (beforeStats?.runoffRadius2Queries ?? 0));
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
    hintedArcQueries: phase.hintedArcQueries,
    segmentNeighborhoodQueries: phase.segmentNeighborhoodQueries,
    segmentNeighborhoodBatchCalls: phase.segmentNeighborhoodBatchCalls,
    runoffRadius1Queries: phase.runoffRadius1Queries,
    runoffRadius2Queries: phase.runoffRadius2Queries,
  }]));

  return {
    operations: profile.simulationSteps,
    checks: {
      steps: profile.simulationSteps,
      phaseNames: Object.keys(phaseEntries),
      phases: phaseEntries,
      prePhysicsNearestQueries: phaseEntries.prePhysicsWheelSurface?.nearestQueries ?? 0,
      runoffNearestQueries: phaseEntries.runoffResponse?.nearestQueries ?? 0,
      runoffHintedArcQueries: phaseEntries.runoffResponse?.hintedArcQueries ?? 0,
      runoffSegmentNeighborhoodQueries: phaseEntries.runoffResponse?.segmentNeighborhoodQueries ?? 0,
      runoffRadius1Queries: phaseEntries.runoffResponse?.runoffRadius1Queries ?? 0,
      runoffRadius2Queries: phaseEntries.runoffResponse?.runoffRadius2Queries ?? 0,
      localRefreshNearestQueries: phaseEntries.localSurfaceRefresh?.nearestQueries ?? 0,
      localRefreshHintedArcQueries: phaseEntries.localSurfaceRefresh?.hintedArcQueries ?? 0,
      localRefreshSegmentNeighborhoodQueries: phaseEntries.localSurfaceRefresh?.segmentNeighborhoodQueries ?? 0,
      localRefreshSegmentNeighborhoodBatchCalls: phaseEntries.localSurfaceRefresh?.segmentNeighborhoodBatchCalls ?? 0,
      broadCommitNearestQueries: phaseEntries.broadRaceCommit?.nearestQueries ?? 0,
      broadCommitCalls: phaseEntries.broadRaceCommit?.calls ?? 0,
    },
  };
}

function benchmarkTimingMaintenance(profile) {
  const steps = profile.timingMaintenanceSteps ?? profile.simulationSteps;
  const cars = Array.from({ length: 20 }, (_, index) => ({
    id: `timing-bench-${index}`,
    raceDistance: index * 5,
    previousRaceDistanceForTiming: index * 5,
    timingHistory: [],
    timingLineCrossings: Object.create(null),
    timingLineLastUpdatedAt: 0,
  }));
  const track = {
    length: 5600,
    timingLines: {
      spacing: 35,
      count: 160,
    },
  };
  let currentTime = 0;
  for (let step = 0; step < steps; step += 1) {
    currentTime += 1 / 60;
    for (let index = 0; index < cars.length; index += 1) {
      const car = cars[index];
      const previousDistance = car.raceDistance;
      car.raceDistance += 8 + (index % 3);
      recordTimingSample(car, currentTime);
      recordTimingLineCrossings(car, previousDistance, currentTime, track);
      car.previousRaceDistanceForTiming = car.raceDistance;
    }
  }
  let activeHistorySamplesMax = 0;
  let storedHistorySamplesMax = 0;
  let lineStoredSpanMax = 0;
  let carsWithPrunedTimingLines = 0;
  let directSegmentCacheHits = 0;
  let zeroTravelOwnKeysCalls = 0;
  const zeroTravelCalls = 10000;
  const zeroTravelCar = cars[0];
  const zeroTravelCrossings = zeroTravelCar.timingLineCrossings;
  zeroTravelCar.timingLineCrossings = new Proxy(zeroTravelCrossings, {
    ownKeys(target) {
      zeroTravelOwnKeysCalls += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      return Object.getOwnPropertyDescriptor(target, property);
    },
  });
  const zeroTravelDistance = zeroTravelCar.raceDistance;
  for (let call = 0; call < zeroTravelCalls; call += 1) {
    currentTime += 1 / 60;
    recordTimingLineCrossings(zeroTravelCar, zeroTravelDistance, currentTime, track);
  }
  const interpolationCar = cars[cars.length - 1];
  interpolationCar.timingHistory._interpolationStats = { directSegmentCacheHits: 0 };
  interpolateTimeAtDistance(interpolationCar.timingHistory, interpolationCar.raceDistance - 18);
  interpolateTimeAtDistance(interpolationCar.timingHistory, interpolationCar.raceDistance - 19);
  interpolateTimeAtDistance(interpolationCar.timingHistory, interpolationCar.raceDistance - 20);
  directSegmentCacheHits = interpolationCar.timingHistory._interpolationStats.directSegmentCacheHits ?? 0;
  cars.forEach((car) => {
    const isStructuredHistory = car.timingHistory?.times instanceof Float64Array &&
      car.timingHistory?.distances instanceof Float64Array;
    const startIndex = car.timingHistory?._startIndex ?? 0;
    const activeHistorySamples = isStructuredHistory
      ? (car.timingHistory?._count ?? 0)
      : car.timingHistory.length - startIndex;
    const storedHistorySamples = isStructuredHistory
      ? car.timingHistory.times.length
      : car.timingHistory.length;
    activeHistorySamplesMax = Math.max(activeHistorySamplesMax, activeHistorySamples);
    storedHistorySamplesMax = Math.max(storedHistorySamplesMax, storedHistorySamples);
    const firstLine = car.timingLineFirstStored;
    const lastLine = car.timingLineLastStored;
    if (Number.isInteger(firstLine) && Number.isInteger(lastLine)) {
      lineStoredSpanMax = Math.max(lineStoredSpanMax, lastLine - firstLine + 1);
      if (firstLine > 0) carsWithPrunedTimingLines += 1;
    }
  });
  return {
    operations: (steps * cars.length) + zeroTravelCalls,
    checks: {
      steps,
      cars: cars.length,
      activeHistorySamplesMax,
      storedHistorySamplesMax,
      lineStoredSpanMax,
      maxAllowedLineSpan: track.timingLines.count * TIMING_LINE_HISTORY_LAPS,
      carsWithPrunedTimingLines,
      directSegmentCacheHits,
      zeroTravelCalls,
      zeroTravelOwnKeysCalls,
    },
  };
}

function createTrackedCrossings(entries) {
  let numericGets = 0;
  const target = Object.create(null);
  Object.entries(entries).forEach(([lineNumber, time]) => {
    target[lineNumber] = time;
  });
  return {
    crossings: new Proxy(target, {
      get(innerTarget, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) numericGets += 1;
        return Reflect.get(innerTarget, property, receiver);
      },
    }),
    getNumericGets: () => numericGets,
  };
}

function benchmarkTimingLineGapWithoutStoredCrossings(profile) {
  const aheadCrossings = createTrackedCrossings({ 995: 90, 996: 91 });
  const carCrossings = createTrackedCrossings({ 995: 91.2, 996: 92.2 });
  const ahead = {
    raceDistance: 10008,
    speed: 80,
    timingLineCrossings: aheadCrossings.crossings,
    timingLineFirstStored: null,
    timingLineLastStored: null,
    timingHistory: [
      { time: 99, raceDistance: 10000 },
      { time: 100, raceDistance: 10020 },
    ],
  };
  const car = {
    raceDistance: 10010,
    speed: 75,
    timingLineCrossings: carCrossings.crossings,
    timingLineFirstStored: null,
    timingLineLastStored: null,
  };
  const track = {
    timingLines: {
      spacing: 10,
      count: 160,
    },
  };
  const iterations = profile.timingMaintenanceSteps ?? profile.simulationSteps;
  for (let index = 0; index < iterations; index += 1) {
    estimateTimingLineGapSeconds(ahead, car, 100, track);
  }
  return {
    operations: iterations,
    checks: {
      iterations,
      noStoredTimingLineNumericGets: aheadCrossings.getNumericGets() + carCrossings.getNumericGets(),
    },
  };
}

function benchmarkLapTelemetryInProgress(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 16, physicsMode: 'advanced' });
  const track = sim.track;
  const sectorLength = track.length / 3;
  const currentTime = 12;
  const iterations = profile.timingMaintenanceSteps;
  const cars = sim.cars.slice(0, 16).map((car, index) => {
    const raceDistance = sectorLength + metersToSimUnits(20 + index);
    car.raceDistance = raceDistance;
    resetLapTelemetryState(car, track, currentTime, raceDistance);
    car.lapTelemetry.currentLapStartedAt = 0;
    car.lapTelemetry.currentSectorStartedAt = 0.5;
    car.lapTelemetry.currentSectors[0] = 10 + index * 0.1;
    car.lapTelemetry.liveSectors[0] = 10 + index * 0.1;
    car.lapTelemetry.sectorProgress[0] = 1;
    return {
      car,
      previousRaceDistance: raceDistance - metersToSimUnits(1),
      currentSectors: car.lapTelemetry.currentSectors,
      liveSectors: car.lapTelemetry.liveSectors,
      sectorProgress: car.lapTelemetry.sectorProgress,
    };
  });

  let sectorArraysReused = true;
  let noBoundaryCrosses = true;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let index = 0; index < cars.length; index += 1) {
      const entry = cars[index];
      const crossedBoundary = updateLapTelemetry(entry.car, entry.previousRaceDistance, currentTime, track, sim.totalLaps);
      if (crossedBoundary) noBoundaryCrosses = false;
      if (
        entry.car.lapTelemetry.currentSectors !== entry.currentSectors ||
        entry.car.lapTelemetry.liveSectors !== entry.liveSectors ||
        entry.car.lapTelemetry.sectorProgress !== entry.sectorProgress
      ) {
        sectorArraysReused = false;
      }
    }
  }

  return {
    operations: iterations * cars.length,
    checks: {
      iterations,
      cars: cars.length,
      sectorArraysReused,
      noBoundaryCrosses,
    },
  };
}

function benchmarkPitRouteTransition(profile) {
  const route = createRoute(createPitRouteBenchmarkPoints());
  route.runtimeBenchmarkStats = {};
  const sampleTarget = { x: 0, y: 0, heading: 0, limiterActive: false };
  const operations = profile.pitRouteIterations;
  let sampleContainerReused = true;
  let projectionScratchReused = true;
  let limiterActiveSamples = 0;
  let finiteLimiterDistances = 0;
  let previousDistance = 0;
  let projectionScratch = null;

  for (let iteration = 0; iteration < operations; iteration += 1) {
    const distance = 0.5 + ((iteration * 7.25) % Math.max(1, route.length - 1));
    const point = sampleRouteInto(sampleTarget, route, distance);
    if (point !== sampleTarget) sampleContainerReused = false;
    const car = {
      x: point.x + ((iteration % 5) - 2) * 0.2,
      y: point.y + (((iteration + 2) % 5) - 2) * 0.2,
    };
    previousDistance = nearestDistanceOnRoute(route, car, previousDistance);
    if (!projectionScratch) projectionScratch = route._projectionScratch;
    else if (route._projectionScratch !== projectionScratch) projectionScratchReused = false;
    if (routeLimiterActiveAt(route, previousDistance)) limiterActiveSamples += 1;
    if (Number.isFinite(distanceToNextLimiterSegment(route, previousDistance))) finiteLimiterDistances += 1;
  }

  return {
    operations,
    checks: {
      iterations: operations,
      routeSegments: route.segments.length,
      sampleRouteIntoCalls: route.runtimeBenchmarkStats.sampleRouteIntoCalls ?? 0,
      sampleRouteAllocations: route.runtimeBenchmarkStats.sampleRouteAllocations ?? 0,
      segmentFallbackScans: route.runtimeBenchmarkStats.segmentFallbackScans ?? 0,
      sampleContainerReused,
      projectionScratchReused,
      limiterActiveSamples,
      finiteLimiterDistances,
    },
  };
}

function createPitRouteBenchmarkPoints() {
  const points = [];
  for (let index = 0; index < 40; index += 1) {
    const x = index * metersToSimUnits(8);
    const y = Math.sin(index * 0.35) * metersToSimUnits(3);
    const nextY = Math.sin((index + 1) * 0.35) * metersToSimUnits(3);
    points.push({
      x,
      y,
      heading: Math.atan2(nextY - y, metersToSimUnits(8)),
      limiterActive: index >= 8 && index <= 25,
    });
  }
  return points;
}

function resetLapTelemetryState(car, track, currentTime, raceDistance) {
  car.lapTelemetry = null;
  car.raceDistance = raceDistance;
  updateLapTelemetry(car, raceDistance, currentTime, track, Infinity);
}

function benchmarkCollision(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 4, physicsMode: 'advanced' });
  const resolverSim = createBenchmarkSimulation({ driverCount: 4, physicsMode: 'advanced' });
  resolverSim.runtimeBenchmarkStats = {};
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
  const resolverBase = pointAt(resolverSim.track, metersToSimUnits(1400));
  resolverSim.cars.forEach((car, index) => {
    resolverSim.setCarState(car.id, {
      x: resolverBase.x + index * 80,
      y: resolverBase.y,
      previousX: resolverBase.x + index * 80,
      previousY: resolverBase.y,
      heading: resolverBase.heading,
      speed: 0,
      progress: resolverBase.distance + index * 80,
      raceDistance: resolverBase.distance + index * 80,
    });
  });

  let candidatePairs = 0;
  let collisions = 0;
  let sweptCollisions = 0;
  const scratch = {};
  let reusedCandidateArray = true;
  let reusedProjectionScratch = true;
  let reusedSweepScratch = true;
  let reusedCollisionResult = true;
  let reusedCollisionAxis = true;
  let reusedShapeCollisionResult = true;
  let reusedShapeCollisionAxis = true;
  let collisionCandidatePairMarksReused = true;
  let collisionDistanceEntryPoolReused = true;
  let collisionMissingDistanceFlagsReused = true;
  let collisionMissingDistanceIndexesReused = true;
  let collisionCollidableCarsReused = true;
  let collisionReportedContactMarksReused = true;
  let collisionStewardContextReused = true;
  let previousCandidates = null;
  let previousCandidatePairMarks = null;
  let previousDistanceEntryPool = null;
  let previousMissingDistanceFlags = null;
  let previousMissingDistanceIndexes = null;
  let previousProjectionScratch = null;
  let previousSweepShapes = null;
  let previousCollisionResult = null;
  let previousCollisionAxis = null;
  let previousShapeCollisionResult = null;
  let previousShapeCollisionAxis = null;
  let previousCollidableCars = null;
  let previousReportedContactMarks = null;
  let previousCollisionStewardContext = null;
  const contactVelocityStats = {
    contactVelocityResponses: 0,
    contactVelocityVectorObjectAllocations: 0,
  };
  const responseFirst = {
    id: 'response-first',
    heading: 0,
    speed: 35,
    velocityX: 35,
    velocityY: 0,
  };
  const responseSecond = {
    id: 'response-second',
    heading: Math.PI,
    speed: 35,
    velocityX: -35,
    velocityY: 0,
  };
  const sweptFirst = {
    previousX: -120,
    previousY: 0,
    x: 120,
    y: 0,
    heading: 0,
    previousHeading: 0,
    speed: 0,
  };
  const sweptSecond = {
    previousX: 0,
    previousY: 120,
    x: 0,
    y: -120,
    heading: Math.PI / 2,
    previousHeading: Math.PI / 2,
    speed: 0,
  };
  for (let iteration = 0; iteration < profile.collisionIterations; iteration += 1) {
    const candidates = buildCollisionCandidatePairs(sim.cars, {
      trackLength: sim.track.length,
      scratch,
    });
    if (previousCandidates && candidates !== previousCandidates) reusedCandidateArray = false;
    previousCandidates = candidates;
    if (previousCandidatePairMarks && scratch.candidatePairMarks !== previousCandidatePairMarks) {
      collisionCandidatePairMarksReused = false;
    }
    previousCandidatePairMarks = scratch.candidatePairMarks ?? previousCandidatePairMarks;
    if (previousDistanceEntryPool && scratch.distanceEntryPool !== previousDistanceEntryPool) {
      collisionDistanceEntryPoolReused = false;
    }
    previousDistanceEntryPool = scratch.distanceEntryPool ?? previousDistanceEntryPool;
    if (previousMissingDistanceFlags && scratch.missingDistanceFlags !== previousMissingDistanceFlags) {
      collisionMissingDistanceFlagsReused = false;
    }
    previousMissingDistanceFlags = scratch.missingDistanceFlags ?? previousMissingDistanceFlags;
    if (previousMissingDistanceIndexes && scratch.missingDistanceIndexes !== previousMissingDistanceIndexes) {
      collisionMissingDistanceIndexesReused = false;
    }
    previousMissingDistanceIndexes = scratch.missingDistanceIndexes ?? previousMissingDistanceIndexes;
    candidatePairs += candidates.length;
    candidates.forEach(([first, second]) => {
      if (detectVehicleCollision(first, second, { scratch })) collisions += 1;
      if (previousProjectionScratch && scratch.projectionScratch !== previousProjectionScratch) reusedProjectionScratch = false;
      previousProjectionScratch = scratch.projectionScratch ?? previousProjectionScratch;
      if (previousSweepShapes && scratch.sweepShapes !== previousSweepShapes) reusedSweepScratch = false;
      previousSweepShapes = scratch.sweepShapes ?? previousSweepShapes;
      if (previousCollisionResult && scratch.vehicleCollisionResult !== previousCollisionResult) reusedCollisionResult = false;
      previousCollisionResult = scratch.vehicleCollisionResult ?? previousCollisionResult;
      if (previousCollisionAxis && scratch.vehicleCollisionResult?.axis !== previousCollisionAxis) reusedCollisionAxis = false;
      previousCollisionAxis = scratch.vehicleCollisionResult?.axis ?? previousCollisionAxis;
      if (previousShapeCollisionResult && scratch.shapeCollisionResult !== previousShapeCollisionResult) reusedShapeCollisionResult = false;
      previousShapeCollisionResult = scratch.shapeCollisionResult ?? previousShapeCollisionResult;
      if (previousShapeCollisionAxis && scratch.shapeCollisionResult?.axis !== previousShapeCollisionAxis) reusedShapeCollisionAxis = false;
      previousShapeCollisionAxis = scratch.shapeCollisionResult?.axis ?? previousShapeCollisionAxis;
    });
    if (detectVehicleCollision(sweptFirst, sweptSecond, { scratch })) sweptCollisions += 1;
    if (previousProjectionScratch && scratch.projectionScratch !== previousProjectionScratch) reusedProjectionScratch = false;
    previousProjectionScratch = scratch.projectionScratch ?? previousProjectionScratch;
    if (previousSweepShapes && scratch.sweepShapes !== previousSweepShapes) reusedSweepScratch = false;
    previousSweepShapes = scratch.sweepShapes ?? previousSweepShapes;
    if (previousCollisionResult && scratch.vehicleCollisionResult !== previousCollisionResult) reusedCollisionResult = false;
    previousCollisionResult = scratch.vehicleCollisionResult ?? previousCollisionResult;
    if (previousCollisionAxis && scratch.vehicleCollisionResult?.axis !== previousCollisionAxis) reusedCollisionAxis = false;
    previousCollisionAxis = scratch.vehicleCollisionResult?.axis ?? previousCollisionAxis;
    if (previousShapeCollisionResult && scratch.shapeCollisionResult !== previousShapeCollisionResult) reusedShapeCollisionResult = false;
    previousShapeCollisionResult = scratch.shapeCollisionResult ?? previousShapeCollisionResult;
    if (previousShapeCollisionAxis && scratch.shapeCollisionResult?.axis !== previousShapeCollisionAxis) reusedShapeCollisionAxis = false;
    previousShapeCollisionAxis = scratch.shapeCollisionResult?.axis ?? previousShapeCollisionAxis;
    responseFirst.speed = 35;
    responseFirst.velocityX = 35;
    responseFirst.velocityY = 0;
    responseSecond.speed = 35;
    responseSecond.velocityX = -35;
    responseSecond.velocityY = 0;
    applyContactVelocityResponse(sim, responseFirst, responseSecond, { x: 1, y: 0 }, { stats: contactVelocityStats });
    const resolverPoint = pointAt(resolverSim.track, metersToSimUnits(1400));
    const resolverHeading = resolverPoint.heading;
    resolverSim.setCarState(resolverSim.cars[0].id, {
      x: resolverPoint.x,
      y: resolverPoint.y,
      previousX: resolverPoint.x,
      previousY: resolverPoint.y,
      heading: resolverHeading,
      speed: 0,
      progress: resolverPoint.distance,
      raceDistance: resolverPoint.distance,
      velocityX: 0,
      velocityY: 0,
    });
    resolverSim.setCarState(resolverSim.cars[1].id, {
      x: resolverPoint.x + Math.cos(resolverHeading) * 8,
      y: resolverPoint.y + Math.sin(resolverHeading) * 8,
      previousX: resolverPoint.x + Math.cos(resolverHeading) * 8,
      previousY: resolverPoint.y + Math.sin(resolverHeading) * 8,
      heading: resolverHeading,
      speed: 0,
      progress: resolverPoint.distance + 8,
      raceDistance: resolverPoint.distance + 8,
      velocityX: 0,
      velocityY: 0,
    });
    resolverSim.cars[0].contactCooldown = 0;
    resolverSim.cars[1].contactCooldown = 0;
    resolveCollisionsForSimulation(resolverSim);
    if (previousCollidableCars && resolverSim.collisionScratch?.collidableCars !== previousCollidableCars) {
      collisionCollidableCarsReused = false;
    }
    previousCollidableCars = resolverSim.collisionScratch?.collidableCars ?? previousCollidableCars;
    if (
      previousReportedContactMarks &&
      resolverSim.collisionScratch?.reportedContactMarks !== previousReportedContactMarks
    ) {
      collisionReportedContactMarksReused = false;
    }
    previousReportedContactMarks = resolverSim.collisionScratch?.reportedContactMarks ?? previousReportedContactMarks;
    if (
      previousCollisionStewardContext &&
      resolverSim.collisionScratch?.collisionStewardContext !== previousCollisionStewardContext
    ) {
      collisionStewardContextReused = false;
    }
    previousCollisionStewardContext = resolverSim.collisionScratch?.collisionStewardContext ??
      previousCollisionStewardContext;
  }
  return {
    operations: Math.max(1, candidatePairs),
    checks: {
      iterations: profile.collisionIterations,
      candidatePairs,
      collisions,
      sweptCollisions,
      reusedCandidateArray,
      reusedProjectionScratch,
      reusedSweepScratch,
      reusedCollisionResult,
      reusedCollisionAxis,
      reusedShapeCollisionResult,
      reusedShapeCollisionAxis,
      contactVelocityResponses: contactVelocityStats.contactVelocityResponses,
      contactVelocityVectorObjectAllocations: contactVelocityStats.contactVelocityVectorObjectAllocations,
      collisionCandidatePairMarksReused: Boolean(previousCandidatePairMarks) && collisionCandidatePairMarksReused,
      collisionCandidateKeysSetAllocated: scratch.candidateKeys instanceof Set,
      collisionCarOrderMapAllocated: scratch.carOrder instanceof Map,
      collisionMissingDistanceSetAllocated: scratch.missingDistance instanceof Set,
      collisionDistanceEntryPoolReused: Boolean(previousDistanceEntryPool) && collisionDistanceEntryPoolReused,
      collisionMissingDistanceFlagsReused: Boolean(previousMissingDistanceFlags) && collisionMissingDistanceFlagsReused,
      collisionMissingDistanceIndexesReused: Boolean(previousMissingDistanceIndexes) && collisionMissingDistanceIndexesReused,
      collisionCollidableCarsReused,
      collisionReportedContactMarksReused: Boolean(previousReportedContactMarks) && collisionReportedContactMarksReused,
      collisionReportedContactsSetAllocated: resolverSim.collisionScratch?.reportedContacts instanceof Set,
      collisionStewardContextReused: Boolean(previousCollisionStewardContext) && collisionStewardContextReused,
      collisionStewardReviews: resolverSim.runtimeBenchmarkStats?.collisionStewardReviews ?? 0,
      collisionStewardPenaltyArrayAllocations: resolverSim.runtimeBenchmarkStats?.collisionStewardPenaltyArrayAllocations ?? 0,
    },
  };
}

function benchmarkTrackQueries(track, profile) {
  const queries = precomputeNearestQueries(track);
  const hintedQueries = precomputeHintedQueries(track);
  const pitRoadQueries = precomputePitRoadQueries(track);
  const queryScratch = track?.queryIndex?.queryScratch ?? null;
  let firstNearestProjectionScratch = null;
  let nearestProjectionScratchReused = true;
  let firstPitRoadProjectionScratch = null;
  let firstPitRoadProjectionPoint = null;
  let firstPitRoadProjectionDistances = null;
  let pitRoadProjectionScratchReused = true;
  let firstPitConnectorProjectionScratch = null;
  let firstPitConnectorProjectionPoint = null;
  let pitConnectorProjectionScratchReused = true;
  resetTrackQueryStats(track);
  for (let iteration = 0; iteration < profile.trackQueryIterations; iteration += 1) {
    queries.forEach(({ position, progressHint }) => {
      const beforeConnectorDirectStates = track?.queryIndex?.stats?.pitPaths?.['connector-direct-state'] ?? 0;
      const beforeConnectorDirectSkips = track?.queryIndex?.stats?.pitPaths?.['connector-direct-skip'] ?? 0;
      nearestTrackState(track, position, progressHint);
      const afterConnectorDirectStates = track?.queryIndex?.stats?.pitPaths?.['connector-direct-state'] ?? 0;
      const afterConnectorDirectSkips = track?.queryIndex?.stats?.pitPaths?.['connector-direct-skip'] ?? 0;
      if (
        afterConnectorDirectStates > beforeConnectorDirectStates ||
        afterConnectorDirectSkips > beforeConnectorDirectSkips
      ) {
        const currentPitConnectorProjectionScratch = queryScratch?.pitRoadProjection ?? null;
        const currentPitConnectorProjectionPoint = currentPitConnectorProjectionScratch?.point ?? null;
        if (!currentPitConnectorProjectionScratch || !currentPitConnectorProjectionPoint) {
          pitConnectorProjectionScratchReused = false;
        } else if (!firstPitConnectorProjectionScratch) {
          firstPitConnectorProjectionScratch = currentPitConnectorProjectionScratch;
          firstPitConnectorProjectionPoint = currentPitConnectorProjectionPoint;
        } else if (
          currentPitConnectorProjectionScratch !== firstPitConnectorProjectionScratch ||
          currentPitConnectorProjectionPoint !== firstPitConnectorProjectionPoint
        ) {
          pitConnectorProjectionScratchReused = false;
        }
      }
      const currentNearestProjectionScratch = queryScratch?.nearestProjection ?? null;
      if (!firstNearestProjectionScratch) {
        firstNearestProjectionScratch = currentNearestProjectionScratch;
      } else if (currentNearestProjectionScratch !== firstNearestProjectionScratch) {
        nearestProjectionScratchReused = false;
      }
      const currentPitRoadProjectionScratch = track?.queryIndex?.queryScratch?.pitRoadProjection ?? null;
      if (currentPitRoadProjectionScratch) {
        const currentPitRoadProjectionPoint = currentPitRoadProjectionScratch.point ?? null;
        const currentPitRoadProjectionDistances = track?.queryIndex?.queryScratch?.pitRoadProjectionScratch?.cumulativeDistances ?? null;
        if (!firstPitRoadProjectionScratch) {
          firstPitRoadProjectionScratch = currentPitRoadProjectionScratch;
          firstPitRoadProjectionPoint = currentPitRoadProjectionPoint;
          firstPitRoadProjectionDistances = currentPitRoadProjectionDistances;
        } else if (
          currentPitRoadProjectionScratch !== firstPitRoadProjectionScratch ||
          currentPitRoadProjectionPoint !== firstPitRoadProjectionPoint ||
          currentPitRoadProjectionDistances !== firstPitRoadProjectionDistances
        ) {
          pitRoadProjectionScratchReused = false;
        }
      }
    });
    pitRoadQueries.forEach(({ position, progressHint }) => {
      nearestPitLaneState(track, position, progressHint);
      const currentPitRoadProjectionScratch = track?.queryIndex?.queryScratch?.pitRoadProjection ?? null;
      if (currentPitRoadProjectionScratch) {
        const currentPitRoadProjectionPoint = currentPitRoadProjectionScratch.point ?? null;
        const currentPitRoadProjectionDistances = track?.queryIndex?.queryScratch?.pitRoadProjectionScratch?.cumulativeDistances ?? null;
        if (!firstPitRoadProjectionScratch) {
          firstPitRoadProjectionScratch = currentPitRoadProjectionScratch;
          firstPitRoadProjectionPoint = currentPitRoadProjectionPoint;
          firstPitRoadProjectionDistances = currentPitRoadProjectionDistances;
        } else if (
          currentPitRoadProjectionScratch !== firstPitRoadProjectionScratch ||
          currentPitRoadProjectionPoint !== firstPitRoadProjectionPoint ||
          currentPitRoadProjectionDistances !== firstPitRoadProjectionDistances
        ) {
          pitRoadProjectionScratchReused = false;
        }
      }
    });
    hintedQueries.forEach(({ position, progressHint }) => {
      queryHintedTrackProjection(track, position, progressHint);
    });
  }
  const stats = snapshotTrackQueryStats(track);
  return {
    operations: (queries.length + pitRoadQueries.length + hintedQueries.length) * profile.trackQueryIterations,
    checks: {
      trackQueryIterations: profile.trackQueryIterations,
      nearestQueries: stats?.nearestQueries ?? 0,
      hintDistanceCacheHits: stats?.hintDistanceCacheHits ?? 0,
      precomputedSegmentNeighborhoodHits: stats?.precomputedSegmentNeighborhoodHits ?? 0,
      nearestProjectionScratchReused: Boolean(firstNearestProjectionScratch) && nearestProjectionScratchReused,
      precomputedSegmentProjectionScalars: Boolean(
        track?.queryIndex?.centerline?.deltaX &&
        track?.queryIndex?.centerline?.deltaY &&
        track?.queryIndex?.centerline?.lengthSquared &&
        track?.queryIndex?.centerline?.distanceSpan
      ),
      nearestEmptyCellSkippedRings: stats?.nearestEmptyCellSkippedRings ?? 0,
      nearestIsolatedHintQueries: stats?.nearestIsolatedHintQueries ?? 0,
      nearestLowDensityHintQueries: stats?.nearestLowDensityHintQueries ?? 0,
      nearestLowDensityCellExactQueries: stats?.nearestLowDensityCellExactQueries ?? 0,
      nearestLowDensityCellDirectQueries: stats?.nearestLowDensityCellDirectQueries ?? 0,
      nearestSparseGridExactQueries: stats?.nearestSparseGridExactQueries ?? 0,
      nearestRing2NeighborhoodExactQueries: stats?.nearestRing2NeighborhoodExactQueries ?? 0,
      arcBucketRadius2PrecomputedQueries: stats?.arcBucketRadius2PrecomputedQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      hintedArcQueries: stats?.hintedArcQueries ?? 0,
      hintedSegmentFastPathQueries: stats?.hintedSegmentFastPathQueries ?? 0,
      hintedSegmentWideRadiusQueries: stats?.hintedSegmentWideRadiusQueries ?? 0,
      hintedSegmentWideRadiusHits: stats?.hintedSegmentWideRadiusHits ?? 0,
      candidateProjectionObjectAllocations: stats?.candidateProjectionObjectAllocations ?? 0,
      segmentNeighborhoodIdScratchLength: track?.queryIndex?.queryScratch?.segmentNeighborhoodIds?.length ?? 0,
      pitQueries: stats?.pitQueries ?? 0,
      pitFallbacks: stats?.pitFallbacks ?? 0,
      pitOverrideMainRoadSkips: stats?.pitPaths?.['main-road-skip'] ?? 0,
      pitConnectorDirectStateHits: stats?.pitPaths?.['connector-direct-state'] ?? 0,
      pitConnectorDirectSkips: stats?.pitPaths?.['connector-direct-skip'] ?? 0,
      pitConnectorProjectionScratchReused: Boolean(firstPitConnectorProjectionScratch) &&
        pitConnectorProjectionScratchReused,
      pitConnectorEndpointWindowProjectionCalls: stats?.pitConnectorEndpointWindowProjectionCalls ?? 0,
      pitConnectorFullRouteProjectionScans: stats?.pitConnectorFullRouteProjectionScans ?? 0,
      pitRoadGridHits: stats?.pitPaths?.['road-grid-hit'] ?? 0,
      pitRoadEndpointWindowHits: stats?.pitPaths?.['road-endpoint-window-hit'] ?? 0,
      pitRoadGridMisses: stats?.pitPaths?.['road-grid-miss'] ?? 0,
      pitRoadProjectionScratchReused: Boolean(firstPitRoadProjectionScratch) && pitRoadProjectionScratchReused,
      pitRoadPrecomputedRouteDistances: pitRoutesHavePrecomputedDistances(track),
      pitRoadCumulativeDistanceRebuilds: stats?.pitRoadCumulativeDistanceRebuilds ?? 0,
      pitRoadQueryPoints: pitRoadQueries.length,
      pitRoadQueryCalls: pitRoadQueries.length * profile.trackQueryIterations,
      queryPoints: queries.length,
      hintedQueryPoints: hintedQueries.length,
      hintedQueryCalls: hintedQueries.length * profile.trackQueryIterations,
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
  const offset = 0;
  const position = offsetTrackPoint(center, offset);
  const car = {
    ...snapshot.cars[0],
    x: position.x,
    y: position.y,
    heading: center.heading,
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
  let firstRayChannels = null;
  let firstRayChannelFlagRefs = null;
  let firstRayBoundaryScratchRefs = null;
  let firstRayBoundaryDistanceRefs = null;
  let rayContainersReused = true;
  let rayChannelContainersReused = true;
  let rayChannelFlagContainersReused = true;
  let rayFilteredCarTargetContainersReused = true;
  let rayOptionsNormalizedReused = true;
  let rayBoundaryContainersMaterialized = true;
  let rayBoundaryContainersReused = true;
  let rayBoundaryDistanceArraysReused = true;
  let firstRayTracePoint = null;
  let rayTracePointReused = true;
  const batchScratch = {};
  const firstBatchContext = createRayBatchContext(snapshot, { scratch: batchScratch });
  const firstRayTargets = firstBatchContext.rayTargets;
  const firstRayTarget = firstRayTargets[0];
  const batchContext = createRayBatchContext(snapshot, { scratch: batchScratch });
  const rayTargetContainersReused = batchContext.rayTargets === firstRayTargets &&
    batchContext.rayTargets[0] === firstRayTarget;
  let firstFilteredCarTargets = null;
  let firstFilteredCarTarget = null;
  let firstNormalizedRayOptions = null;
  for (let iteration = 0; iteration < profile.rayIterations; iteration += 1) {
    const rays = buildRaySensors(car, snapshot, rayOptions, batchContext);
    const rayTracePoint = snapshot.track?.queryIndex?.queryScratch?.rayTracePoint;
    if (!rayTracePoint) {
      rayTracePointReused = false;
    } else if (!firstRayTracePoint) {
      firstRayTracePoint = rayTracePoint;
    } else if (rayTracePoint !== firstRayTracePoint) {
      rayTracePointReused = false;
    }
    const normalizedRayOptions = batchContext.scratch?.normalizedRayOptionsBySource?.get(rayOptions);
    if (!normalizedRayOptions) {
      rayOptionsNormalizedReused = false;
    } else if (!firstNormalizedRayOptions) {
      firstNormalizedRayOptions = normalizedRayOptions;
    } else if (normalizedRayOptions !== firstNormalizedRayOptions) {
      rayOptionsNormalizedReused = false;
    }
    const filteredCarTargets = batchContext.scratch?.carTargets;
    if (!Array.isArray(filteredCarTargets)) {
      rayFilteredCarTargetContainersReused = false;
    } else if (!firstFilteredCarTargets) {
      firstFilteredCarTargets = filteredCarTargets;
      firstFilteredCarTarget = filteredCarTargets[0] ?? null;
    } else if (
      filteredCarTargets !== firstFilteredCarTargets ||
      (filteredCarTargets.length > 0 && filteredCarTargets[0] !== firstFilteredCarTarget)
    ) {
      rayFilteredCarTargetContainersReused = false;
    }
    if (!firstRays) {
      firstRays = rays;
      firstRayChannels = rays.map((ray) => ({
        roadEdge: ray.roadEdge,
        track: ray.track,
        kerb: ray.kerb,
        illegalSurface: ray.illegalSurface,
        car: ray.car,
      }));
    } else if (
      rays !== firstRays ||
      rays.length !== firstRays.length ||
      rays.some((ray, index) => ray !== firstRays[index])
    ) {
      rayContainersReused = false;
    }
    if (
      !firstRayChannels ||
      rays.length !== firstRayChannels.length ||
      rays.some((ray, index) => (
        ray.roadEdge !== firstRayChannels[index].roadEdge ||
        ray.track !== firstRayChannels[index].track ||
        ray.kerb !== firstRayChannels[index].kerb ||
        ray.illegalSurface !== firstRayChannels[index].illegalSurface ||
        ray.car !== firstRayChannels[index].car ||
        ray.track !== ray.roadEdge
      ))
    ) {
      rayChannelContainersReused = false;
    }
    const channelFlagRefs = rayChannelFlagScratchRefs(batchContext.scratch?.sharedRayQueries);
    if (
      channelFlagRefs.length !== rays.length ||
      channelFlagRefs.some((entry) => !entry.channelFlags)
    ) {
      rayChannelFlagContainersReused = false;
    }
    if (!firstRayChannelFlagRefs) {
      firstRayChannelFlagRefs = channelFlagRefs;
    } else if (
      channelFlagRefs.length !== firstRayChannelFlagRefs.length ||
      channelFlagRefs.some((entry, index) => entry.channelFlags !== firstRayChannelFlagRefs[index].channelFlags)
    ) {
      rayChannelFlagContainersReused = false;
    }
    const boundaryRefs = rayBoundaryScratchRefs(batchContext.scratch?.sharedRayQueries);
    if (
      boundaryRefs.length !== rays.length ||
      boundaryRefs.some((entry) => !entry.surfaceScratch || !entry.surfaceResult || !entry.surfaceOffsets)
    ) {
      rayBoundaryContainersMaterialized = false;
    }
    if (!firstRayBoundaryScratchRefs) {
      firstRayBoundaryScratchRefs = boundaryRefs;
      firstRayBoundaryDistanceRefs = rayBoundaryDistanceRefs(batchContext.scratch?.sharedRayQueries);
    } else if (
      boundaryRefs.length !== firstRayBoundaryScratchRefs.length ||
      boundaryRefs.some((entry, index) => (
        entry.surfaceScratch !== firstRayBoundaryScratchRefs[index].surfaceScratch ||
        entry.surfaceResult !== firstRayBoundaryScratchRefs[index].surfaceResult ||
        entry.surfaceOffsets !== firstRayBoundaryScratchRefs[index].surfaceOffsets
      ))
    ) {
      rayBoundaryContainersReused = false;
    }
    const boundaryDistanceRefs = rayBoundaryDistanceRefs(batchContext.scratch?.sharedRayQueries);
    if (
      boundaryDistanceRefs.length !== rays.length ||
      boundaryDistanceRefs.some((entry) => (
        !entry.boundaryDistances ||
        !entry.finiteOffsets ||
        !entry.distances ||
        !entry.segmentIds
      ))
    ) {
      rayBoundaryContainersMaterialized = false;
    }
    if (
      !firstRayBoundaryDistanceRefs ||
      boundaryDistanceRefs.length !== firstRayBoundaryDistanceRefs.length ||
      boundaryDistanceRefs.some((entry, index) => (
        entry.boundaryDistances !== firstRayBoundaryDistanceRefs[index].boundaryDistances ||
        entry.finiteOffsets !== firstRayBoundaryDistanceRefs[index].finiteOffsets ||
        entry.distances !== firstRayBoundaryDistanceRefs[index].distances ||
        entry.segmentIds !== firstRayBoundaryDistanceRefs[index].segmentIds
      ))
    ) {
      rayBoundaryDistanceArraysReused = false;
    }
    rayCount += rays.length;
    hitCount += rays.filter((ray) => ray.roadEdge.hit || ray.kerb.hit || ray.illegalSurface.hit || ray.car.hit).length;
  }
  const stats = snapshotTrackQueryStats(snapshot.track);
  const rayBandTraceStats = batchContext.scratch?.rayBandTraceStats ?? {};
  const carRayStats = batchContext.scratch?.carRayStats ?? {};
  return {
    operations: rayCount,
    checks: {
      rayCount,
      hitCount,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      hintedArcQueries: stats?.hintedArcQueries ?? 0,
      segmentNeighborhoodQueries: stats?.segmentNeighborhoodQueries ?? 0,
      raySegmentObjectAllocations: stats?.raySegmentObjectAllocations ?? 0,
      directPathCount: rayBandTraceStats.directPathCount ?? 0,
      sampledPathCount: rayBandTraceStats.sampledPathCount ?? 0,
      fallbackCount: rayBandTraceStats.fallbackCount ?? 0,
      rayChannelSetAllocations: rayBandTraceStats.channelSetAllocations ?? 0,
      carRayCallerVectorCount: carRayStats.callerVectorCount ?? 0,
      carRayComputedVectorCount: carRayStats.computedVectorCount ?? 0,
      carRayResultTargetCount: carRayStats.resultTargetCount ?? 0,
      rayTargetContainersReused,
      rayFilteredCarTargetContainersReused,
      rayOptionsNormalizedReused,
      rayContainersReused,
      rayChannelContainersReused,
      rayChannelFlagContainersReused,
      rayBoundaryContainersMaterialized,
      rayBoundaryContainersReused,
      rayBoundaryDistanceArraysReused,
      rayTracePointReused: Boolean(firstRayTracePoint) && rayTracePointReused,
    },
  };
}

function rayChannelFlagScratchRefs(sharedRayQueries = []) {
  const refs = [];
  for (let index = 0; index < sharedRayQueries.length; index += 1) {
    refs.push({
      channelFlags: sharedRayQueries[index]?.channelFlags,
    });
  }
  return refs;
}

function rayBoundaryScratchRefs(sharedRayQueries = []) {
  const refs = [];
  for (let index = 0; index < sharedRayQueries.length; index += 1) {
    const surfaceScratch = sharedRayQueries[index]?.surfaceBoundaryScratch;
    refs.push({
      surfaceScratch,
      surfaceResult: surfaceScratch?.result,
      surfaceOffsets: surfaceScratch?.offsets,
    });
  }
  return refs;
}

function rayBoundaryDistanceRefs(sharedRayQueries = []) {
  const refs = [];
  for (let index = 0; index < sharedRayQueries.length; index += 1) {
    const boundaryDistances = sharedRayQueries[index]?.surfaceBoundaryScratch?.boundaryDistances;
    refs.push({
      boundaryDistances,
      finiteOffsets: boundaryDistances?.finiteOffsets,
      distances: boundaryDistances?.distances,
      segmentIds: boundaryDistances?.segmentIds,
    });
  }
  return refs;
}

function benchmarkBatchTrainingSurfaceRays(profile) {
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
  const position = offsetTrackPoint(center, 0);
  const car = {
    ...snapshot.cars[0],
    x: position.x,
    y: position.y,
    heading: center.heading,
    progress: center.distance,
    signedOffset: 0,
    trackState: {
      ...center,
      signedOffset: 0,
      crossTrackError: 0,
      surface: 'track',
      inPitLane: false,
    },
    interaction: { profile: 'batch-training' },
  };
  const rayOptions = {
    rays: [
      { id: 'surface-left', angleDegrees: -42, lengthMeters: 220 },
      { id: 'surface-front-left', angleDegrees: -18, lengthMeters: 220 },
      { id: 'surface-front-right', angleDegrees: 18, lengthMeters: 220 },
      { id: 'surface-right', angleDegrees: 42, lengthMeters: 220 },
    ],
    channels: ['kerb', 'illegalSurface'],
    precision: 'driver',
  };

  resetTrackQueryStats(snapshot.track);
  let rayCount = 0;
  let hitCount = 0;
  let firstTraceResultRefs = null;
  let firstSurfaceBoundaryRefs = null;
  let firstSurfaceBoundaryDistanceRefs = null;
  let traceResultContainersReused = true;
  let traceResultChannelObjectsReused = true;
  let surfaceBoundaryContainersReused = true;
  let surfaceBoundaryDistanceArraysReused = true;
  let firstRayTracePoint = null;
  let rayTracePointReused = true;
  const batchScratch = {};
  const batchContext = createRayBatchContext(snapshot, { scratch: batchScratch });
  for (let iteration = 0; iteration < profile.rayIterations; iteration += 1) {
    const rays = buildRaySensors(car, snapshot, rayOptions, batchContext);
    const rayTracePoint = snapshot.track?.queryIndex?.queryScratch?.rayTracePoint;
    if (!rayTracePoint) {
      rayTracePointReused = false;
    } else if (!firstRayTracePoint) {
      firstRayTracePoint = rayTracePoint;
    } else if (rayTracePoint !== firstRayTracePoint) {
      rayTracePointReused = false;
    }
    const traceResultRefs = rayTraceResultRefs(batchContext.scratch?.sharedRayQueries);
    const surfaceBoundaryRefs = raySurfaceBoundaryRefs(batchContext.scratch?.sharedRayQueries);
    const surfaceBoundaryDistanceRefs = raySurfaceBoundaryDistanceRefs(batchContext.scratch?.sharedRayQueries);
    if (!firstTraceResultRefs) {
      firstTraceResultRefs = traceResultRefs;
      firstSurfaceBoundaryRefs = surfaceBoundaryRefs;
      firstSurfaceBoundaryDistanceRefs = surfaceBoundaryDistanceRefs;
    } else {
      if (
        traceResultRefs.length !== firstTraceResultRefs.length ||
        traceResultRefs.some((entry, index) => entry.traceResult !== firstTraceResultRefs[index].traceResult)
      ) {
        traceResultContainersReused = false;
      }
      if (
        traceResultRefs.length !== firstTraceResultRefs.length ||
        traceResultRefs.some((entry, index) => (
          entry.roadEdge !== firstTraceResultRefs[index].roadEdge ||
          entry.kerb !== firstTraceResultRefs[index].kerb ||
          entry.illegalSurface !== firstTraceResultRefs[index].illegalSurface
        ))
      ) {
        traceResultChannelObjectsReused = false;
      }
      if (
        surfaceBoundaryRefs.length !== firstSurfaceBoundaryRefs.length ||
        surfaceBoundaryRefs.some((entry, index) => (
          entry.surfaceScratch !== firstSurfaceBoundaryRefs[index].surfaceScratch ||
          entry.surfaceResult !== firstSurfaceBoundaryRefs[index].surfaceResult ||
          entry.surfaceOffsets !== firstSurfaceBoundaryRefs[index].surfaceOffsets
        ))
      ) {
        surfaceBoundaryContainersReused = false;
      }
      if (
        surfaceBoundaryDistanceRefs.length !== firstSurfaceBoundaryDistanceRefs.length ||
        surfaceBoundaryDistanceRefs.some((entry, index) => (
          entry.boundaryDistances !== firstSurfaceBoundaryDistanceRefs[index].boundaryDistances ||
          entry.finiteOffsets !== firstSurfaceBoundaryDistanceRefs[index].finiteOffsets ||
          entry.distances !== firstSurfaceBoundaryDistanceRefs[index].distances ||
          entry.segmentIds !== firstSurfaceBoundaryDistanceRefs[index].segmentIds
        ))
      ) {
        surfaceBoundaryDistanceArraysReused = false;
      }
    }
    rayCount += rays.length;
    for (let index = 0; index < rays.length; index += 1) {
      if (rays[index].kerb.hit || rays[index].illegalSurface.hit) hitCount += 1;
    }
  }
  const stats = snapshotTrackQueryStats(snapshot.track);
  const rayBandTraceStats = batchContext.scratch?.rayBandTraceStats ?? {};
  return {
    operations: rayCount,
    checks: {
      rayCount,
      hitCount,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      hintedArcQueries: stats?.hintedArcQueries ?? 0,
      segmentNeighborhoodQueries: stats?.segmentNeighborhoodQueries ?? 0,
      raySegmentObjectAllocations: stats?.raySegmentObjectAllocations ?? 0,
      directPathCount: rayBandTraceStats.directPathCount ?? 0,
      sampledPathCount: rayBandTraceStats.sampledPathCount ?? 0,
      fallbackCount: rayBandTraceStats.fallbackCount ?? 0,
      traceResultContainersReused,
      traceResultChannelObjectsReused,
      surfaceBoundaryContainersReused,
      surfaceBoundaryDistanceArraysReused,
      rayTracePointReused: Boolean(firstRayTracePoint) && rayTracePointReused,
    },
  };
}

function rayTraceResultRefs(sharedRayQueries = []) {
  const refs = [];
  for (let index = 0; index < sharedRayQueries.length; index += 1) {
    const traceResult = sharedRayQueries[index]?.traceResult;
    refs.push({
      traceResult,
      roadEdge: traceResult?.roadEdge,
      kerb: traceResult?.kerb,
      illegalSurface: traceResult?.illegalSurface,
    });
  }
  return refs;
}

function raySurfaceBoundaryRefs(sharedRayQueries = []) {
  const refs = [];
  for (let index = 0; index < sharedRayQueries.length; index += 1) {
    const surfaceScratch = sharedRayQueries[index]?.surfaceBoundaryScratch;
    refs.push({
      surfaceScratch,
      surfaceResult: surfaceScratch?.result,
      surfaceOffsets: surfaceScratch?.offsets,
    });
  }
  return refs;
}

function raySurfaceBoundaryDistanceRefs(sharedRayQueries = []) {
  const refs = [];
  for (let index = 0; index < sharedRayQueries.length; index += 1) {
    const boundaryDistances = sharedRayQueries[index]?.surfaceBoundaryScratch?.boundaryDistances;
    refs.push({
      boundaryDistances,
      finiteOffsets: boundaryDistances?.finiteOffsets,
      distances: boundaryDistances?.distances,
      segmentIds: boundaryDistances?.segmentIds,
    });
  }
  return refs;
}

function benchmarkBarrierIllegalSurfaceValidation(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 1 });
  const snapshot = sim.snapshotObservation();
  const center = pointAt(snapshot.track, metersToSimUnits(900));
  const offset = snapshot.track.width / 2 +
    snapshot.track.kerbWidth +
    snapshot.track.gravelWidth +
    snapshot.track.runoffWidth +
    metersToSimUnits(38);
  const origin = offsetTrackPoint(center, offset);
  const originState = {
    ...center,
    signedOffset: offset,
    crossTrackError: Math.abs(offset),
    surface: 'barrier',
    inPitLane: false,
  };
  const vector = {
    x: center.normalX * -1,
    y: center.normalY * -1,
  };
  const lengthMeters = 120;

  resetTrackQueryStats(snapshot.track);
  let directPathCount = 0;
  let sampledPathCount = 0;
  let fallbackCount = 0;
  let hitCount = 0;
  let firstRayTracePoint = null;
  let rayTracePointReused = true;
  for (let iteration = 0; iteration < profile.rayIterations; iteration += 1) {
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector,
      lengthMeters,
      originState,
      channels: ['illegalSurface'],
      precision: 'driver',
    });
    if (trace.path === 'direct') directPathCount += 1;
    else if (trace.path === 'sampled') sampledPathCount += 1;
    else fallbackCount += 1;
    if (trace.illegalSurface.hit) hitCount += 1;
    const rayTracePoint = snapshot.track?.queryIndex?.queryScratch?.rayTracePoint;
    if (!rayTracePoint) {
      rayTracePointReused = false;
    } else if (!firstRayTracePoint) {
      firstRayTracePoint = rayTracePoint;
    } else if (rayTracePoint !== firstRayTracePoint) {
      rayTracePointReused = false;
    }
  }
  const stats = snapshotTrackQueryStats(snapshot.track);
  return {
    operations: profile.rayIterations,
    checks: {
      rayCount: profile.rayIterations,
      hitCount,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      hintedArcQueries: stats?.hintedArcQueries ?? 0,
      segmentNeighborhoodQueries: stats?.segmentNeighborhoodQueries ?? 0,
      segmentNeighborhoodBatchCalls: stats?.segmentNeighborhoodBatchCalls ?? 0,
      raySegmentObjectAllocations: stats?.raySegmentObjectAllocations ?? 0,
      directPathCount,
      sampledPathCount,
      fallbackCount,
      rayTracePointReused: Boolean(firstRayTracePoint) && rayTracePointReused,
    },
  };
}

function benchmarkSampledRecoverySensorRay(profile) {
  const sim = createBenchmarkSimulation({
    driverCount: 2,
    physicsMode: 'advanced',
    rules: {
      modules: {
        pitStops: { enabled: false },
      },
    },
  });
  const snapshot = sim.snapshot();
  const center = pointAt(snapshot.track, metersToSimUnits(900));
  const offset = snapshot.track.width / 2 +
    snapshot.track.kerbWidth +
    snapshot.track.gravelWidth +
    snapshot.track.runoffWidth +
    metersToSimUnits(55);
  const position = offsetTrackPoint(center, offset);
  const origin = {
    x: position.x,
    y: position.y,
    heading: center.heading - Math.PI / 2,
  };
  const rayOrigin = {
    x: origin.x,
    y: origin.y,
  };
  const originState = nearestTrackState(snapshot.track, rayOrigin, center.distance, {
    allowPitOverride: false,
  });
  const vector = {
    x: Math.cos(origin.heading + 40 * Math.PI / 180),
    y: Math.sin(origin.heading + 40 * Math.PI / 180),
  };
  resetTrackQueryStats(snapshot.track);
  let hitCount = 0;
  let directPathCount = 0;
  let sampledPathCount = 0;
  let fallbackCount = 0;
  let firstRayTracePoint = null;
  let rayTracePointReused = true;
  for (let iteration = 0; iteration < profile.rayIterations; iteration += 1) {
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin: rayOrigin,
      vector,
      lengthMeters: 220,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
      sharedRayQuery: {},
    });
    if (trace.path === 'direct') directPathCount += 1;
    else if (trace.path === 'sampled') sampledPathCount += 1;
    else fallbackCount += 1;
    if (trace.illegalSurface.hit) hitCount += 1;
    const rayTracePoint = snapshot.track?.queryIndex?.queryScratch?.rayTracePoint;
    if (!rayTracePoint) {
      rayTracePointReused = false;
    } else if (!firstRayTracePoint) {
      firstRayTracePoint = rayTracePoint;
    } else if (rayTracePoint !== firstRayTracePoint) {
      rayTracePointReused = false;
    }
  }
  const stats = snapshotTrackQueryStats(snapshot.track);
  return {
    operations: profile.rayIterations,
    checks: {
      rayCount: profile.rayIterations,
      hitCount,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      hintedArcQueries: stats?.hintedArcQueries ?? 0,
      segmentNeighborhoodQueries: stats?.segmentNeighborhoodQueries ?? 0,
      segmentNeighborhoodBatchCalls: stats?.segmentNeighborhoodBatchCalls ?? 0,
      raySegmentObjectAllocations: stats?.raySegmentObjectAllocations ?? 0,
      directPathCount,
      sampledPathCount,
      fallbackCount,
      rayTracePointReused: Boolean(firstRayTracePoint) && rayTracePointReused,
    },
  };
}

function benchmarkPitLaneDirectBoundarySensorRay(profile) {
  const sim = createBenchmarkSimulation({
    driverCount: 1,
    physicsMode: 'advanced',
    rules: {
      modules: {
        pitStops: { enabled: true },
      },
    },
  });
  const snapshot = sim.snapshot();
  const pitLane = snapshot.track.pitLane;
  const origin = {
    x: (pitLane.mainLane.start.x + pitLane.mainLane.end.x) / 2,
    y: (pitLane.mainLane.start.y + pitLane.mainLane.end.y) / 2,
  };
  const right = {
    x: -Math.sin(pitLane.mainLane.heading),
    y: Math.cos(pitLane.mainLane.heading),
  };
  const awayFromBoxesAngle = right.x * pitLane.serviceNormal.x + right.y * pitLane.serviceNormal.y > 0
    ? -90
    : 90;
  const vector = {
    x: Math.cos(pitLane.mainLane.heading + awayFromBoxesAngle * Math.PI / 180),
    y: Math.sin(pitLane.mainLane.heading + awayFromBoxesAngle * Math.PI / 180),
  };
  const originState = nearestTrackState(snapshot.track, origin, pitLane.entry.trackDistance, {
    allowPitOverride: true,
  });

  resetTrackQueryStats(snapshot.track);
  let hitCount = 0;
  let directPathCount = 0;
  let sampledPathCount = 0;
  let fallbackCount = 0;
  for (let iteration = 0; iteration < profile.rayIterations; iteration += 1) {
    const trace = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector,
      lengthMeters: 80,
      originState,
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
      sharedRayQuery: {},
      allowPitOverride: true,
    });
    if (trace.path === 'direct') directPathCount += 1;
    else if (trace.path === 'sampled') sampledPathCount += 1;
    else fallbackCount += 1;
    if (trace.roadEdge.hit || trace.kerb.hit || trace.illegalSurface.hit) hitCount += 1;
  }
  const stats = snapshotTrackQueryStats(snapshot.track);
  return {
    operations: profile.rayIterations,
    checks: {
      rayCount: profile.rayIterations,
      hitCount,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      hintedArcQueries: stats?.hintedArcQueries ?? 0,
      segmentNeighborhoodQueries: stats?.segmentNeighborhoodQueries ?? 0,
      segmentNeighborhoodBatchCalls: stats?.segmentNeighborhoodBatchCalls ?? 0,
      raySegmentObjectAllocations: stats?.raySegmentObjectAllocations ?? 0,
      directPathCount,
      sampledPathCount,
      fallbackCount,
    },
  };
}

function benchmarkWheelSurface(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 1, physicsMode: 'advanced' });
  const car = sim.cars[0];
  const pitLane = sim.track.pitLane;
  const entry = pointAt(sim.track, pitLane.entry.trackDistance - metersToSimUnits(4));
  const position = offsetTrackPoint(entry, 0);
  sim.setCarState(car.id, {
    x: position.x,
    y: position.y,
    heading: entry.heading,
    speed: 0,
    progress: entry.distance,
    raceDistance: entry.distance,
  });

  applyWheelSurfaceState(car, sim.track);
  const prePhysicsCurrentGeometryState = car.currentGeometryState;
  car.previousX = car.x - metersToSimUnits(4);
  car.previousY = car.y + metersToSimUnits(1.5);
  car.previousHeading = car.heading + 0.08;
  applyWheelSurfaceState(car, sim.track);
  const currentGeometryStateReusedOnPreviousPoseOnly = car.currentGeometryState === prePhysicsCurrentGeometryState;
  const initialCurrentGeometryState = car.currentGeometryState;
  const initialCurrentBody = initialCurrentGeometryState?.body ?? null;
  const initialCurrentWheel = initialCurrentGeometryState?.wheels?.[0] ?? null;
  const initialCurrentCorner = initialCurrentWheel?.corners?.[0] ?? null;
  const movedEntry = pointAt(sim.track, entry.distance + metersToSimUnits(1));
  const movedPosition = offsetTrackPoint(movedEntry, 0);
  sim.setCarState(car.id, {
    x: movedPosition.x,
    y: movedPosition.y,
    heading: movedEntry.heading,
    speed: 0,
    progress: movedEntry.distance,
    raceDistance: movedEntry.distance,
  });
  car.wheelSurfaceCache = null;
  applyWheelSurfaceState(car, sim.track);
  const currentGeometryContainersReusedOnPoseChange = car.currentGeometryState === initialCurrentGeometryState &&
    car.currentGeometryState?.body === initialCurrentBody &&
    car.currentGeometryState?.wheels?.[0] === initialCurrentWheel &&
    (car.currentGeometryState?.wheels?.[0]?.corners?.[0] ?? null) === initialCurrentCorner;
  const currentGeometryStateHasNoHotSignatures = !Object.hasOwn(car.currentGeometryState ?? {}, 'currentSignature') &&
    !Object.hasOwn(car.currentGeometryState ?? {}, 'signature');

  const directEntry = pointAt(sim.track, pitLane.entry.trackDistance - metersToSimUnits(8));
  const directPosition = offsetTrackPoint(directEntry, sim.track.width / 2 + sim.track.kerbWidth * 0.35);
  const directCar = {
    ...car,
    x: directPosition.x,
    y: directPosition.y,
    heading: directEntry.heading,
    progress: directEntry.distance,
    raceDistance: directEntry.distance,
    wheelSurfaceCache: null,
    wheelSurfaceScratch: null,
    runtimeBenchmarkStats: {},
  };
  const directCenterState = nearestTrackState(sim.track, directCar, directCar.progress);
  let directCalculationConnectorAnalyticSamples = 0;
  let directCalculationSingleSampleWheels = true;
  let directCalculationFreshWheelArrays = true;
  let previousDirectWheelArray = null;
  for (let iteration = 0; iteration < profile.wheelIterations; iteration += 1) {
    const result = calculateWheelSurfaceState({
      car: directCar,
      track: sim.track,
      centerState: directCenterState,
    });
    if (result.sampleMode === 'connector-analytic') directCalculationConnectorAnalyticSamples += 1;
    if (!result.wheels.every((wheel) => wheel.sampledStates.length === 1)) {
      directCalculationSingleSampleWheels = false;
    }
    if (previousDirectWheelArray && result.wheels === previousDirectWheelArray) {
      directCalculationFreshWheelArrays = false;
    }
    previousDirectWheelArray = result.wheels;
  }

  resetTrackQueryStats(sim.track);
  let fullSamples = 0;
  let connectorAnalyticSamples = 0;
  let firstWheelStates = null;
  let firstSampledStates = null;
  let firstTrackState = null;
  let firstTrackLimitState = null;
  let firstWheelSummary = null;
  let firstConnectorQueriedStates = null;
  let firstConnectorQueriedStateObjects = null;
  let firstConnectorProjections = null;
  let firstConnectorProjectionObjects = null;
  let wheelContainersReused = true;
  let wheelSampleStateObjectsReused = true;
  let trackStateObjectReused = true;
  let trackLimitStateObjectReused = true;
  let wheelSummaryContainerReused = true;
  let trackLimitStateFromSummary = true;
  let connectorQueriedStateObjectsReused = true;
  let connectorProjectionObjectsReused = true;
  for (let iteration = 0; iteration < profile.wheelIterations; iteration += 1) {
    car.wheelSurfaceCache = null;
    const result = applyWheelSurfaceState(car, sim.track);
    if (result.sampleMode === 'full') fullSamples += 1;
    if (result.sampleMode === 'connector-analytic') connectorAnalyticSamples += 1;
    if (!firstWheelStates) {
      firstWheelStates = car.wheelStates;
      firstSampledStates = car.wheelStates.map((wheel) => wheel.sampledStates[0]);
      firstTrackState = car.trackState;
      firstTrackLimitState = car.trackLimitState;
      firstWheelSummary = car.wheelSurfaceScratch?.summary ?? null;
      firstConnectorQueriedStates = car.wheelSurfaceScratch?.connectorQueriedStatePools ?? null;
      firstConnectorQueriedStateObjects = firstConnectorQueriedStates?.map((state) => state) ?? null;
      firstConnectorProjections = car.wheelSurfaceScratch?.connectorProjectionPools ?? null;
      firstConnectorProjectionObjects = firstConnectorProjections?.map((projection) => projection) ?? null;
    } else if (
      car.wheelStates !== firstWheelStates ||
      car.wheelStates.length !== firstWheelStates.length ||
      car.wheelStates.some((wheel, index) => wheel !== firstWheelStates[index])
    ) {
      wheelContainersReused = false;
    }
    if (
      !firstSampledStates ||
      car.wheelStates.length !== firstSampledStates.length ||
      car.wheelStates.some((wheel, index) => wheel.sampledStates[0] !== firstSampledStates[index])
    ) {
      wheelSampleStateObjectsReused = false;
    }
    if (car.trackState !== firstTrackState) {
      trackStateObjectReused = false;
    }
    if (car.trackLimitState !== firstTrackLimitState) {
      trackLimitStateObjectReused = false;
    }
    if (car.wheelSurfaceScratch?.summary !== firstWheelSummary) {
      wheelSummaryContainerReused = false;
    }
    if (car.trackLimitState !== car.wheelSurfaceScratch?.summary?.trackLimits) {
      trackLimitStateFromSummary = false;
    }
    if (
      firstConnectorQueriedStates &&
      (
        car.wheelSurfaceScratch?.connectorQueriedStatePools !== firstConnectorQueriedStates ||
        car.wheelSurfaceScratch.connectorQueriedStatePools.length !== firstConnectorQueriedStateObjects.length ||
        car.wheelSurfaceScratch.connectorQueriedStatePools.some((state, index) => state !== firstConnectorQueriedStateObjects[index])
      )
    ) {
      connectorQueriedStateObjectsReused = false;
    }
    if (
      firstConnectorProjections &&
      (
        car.wheelSurfaceScratch?.connectorProjectionPools !== firstConnectorProjections ||
        car.wheelSurfaceScratch.connectorProjectionPools.length !== firstConnectorProjectionObjects.length ||
        car.wheelSurfaceScratch.connectorProjectionPools.some((projection, index) => projection !== firstConnectorProjectionObjects[index])
      )
    ) {
      connectorProjectionObjectsReused = false;
    }
  }
  const stats = snapshotTrackQueryStats(sim.track);
  return {
    operations: profile.wheelIterations,
    checks: {
      wheelIterations: profile.wheelIterations,
      fullSamples,
      connectorAnalyticSamples,
      directCalculationConnectorAnalyticSamples,
      directCalculationScratchlessScalarWheelBatches: directCar.runtimeBenchmarkStats.scratchlessScalarWheelBatches ?? 0,
      directCalculationScratchlessScalarWheelWrites: directCar.runtimeBenchmarkStats.scratchlessScalarWheelWrites ?? 0,
      directCalculationSingleSampleWheels,
      directCalculationFreshWheelArrays,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      hintedArcQueries: stats?.hintedArcQueries ?? 0,
      segmentNeighborhoodQueries: stats?.segmentNeighborhoodQueries ?? 0,
      segmentNeighborhoodBatchCalls: stats?.segmentNeighborhoodBatchCalls ?? 0,
      pitQueries: stats?.pitQueries ?? 0,
      pitBoxGridMisses: stats?.pitPaths?.['box-grid-miss'] ?? 0,
      connectorQueriedStatePoolLength: car.wheelSurfaceScratch?.connectorQueriedStatePools?.length ?? 0,
      wheelContainersReused,
      wheelSampleStateObjectsReused,
      trackStateObjectReused,
      trackLimitStateObjectReused,
      wheelSummaryContainerReused,
      trackLimitStateFromSummary,
      connectorQueriedStateObjectsReused,
      connectorProjectionObjectsReused,
      currentGeometryStateReusedOnPreviousPoseOnly,
      currentGeometryContainersReusedOnPoseChange,
      currentGeometryStateHasNoHotSignatures,
    },
  };
}

function benchmarkConnectorLocalRefreshWheelSurface(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 1, physicsMode: 'advanced' });
  const car = sim.cars[0];
  const pitLane = sim.track.pitLane;
  const entry = pointAt(sim.track, pitLane.entry.trackDistance - metersToSimUnits(4));
  const position = offsetTrackPoint(entry, 0);
  sim.setCarState(car.id, {
    x: position.x,
    y: position.y,
    heading: entry.heading,
    speed: 0,
    progress: entry.distance,
    raceDistance: entry.distance,
  });

  const centerState = queryRunoffTrackStateForCar(sim.track, car).state;

  applyWheelSurfaceState(car, sim.track, { centerState, cacheAsAuto: true });
  const prePhysicsCurrentGeometryState = car.currentGeometryState;
  car.previousX = car.x - metersToSimUnits(4);
  car.previousY = car.y + metersToSimUnits(1.5);
  car.previousHeading = car.heading + 0.08;
  applyWheelSurfaceState(car, sim.track, { centerState, cacheAsAuto: true });
  const currentGeometryStateReusedOnPreviousPoseOnly = car.currentGeometryState === prePhysicsCurrentGeometryState;
  const initialCurrentGeometryState = car.currentGeometryState;
  const initialCurrentBody = initialCurrentGeometryState?.body ?? null;
  const initialCurrentWheel = initialCurrentGeometryState?.wheels?.[0] ?? null;
  const initialCurrentCorner = initialCurrentWheel?.corners?.[0] ?? null;
  const movedEntry = pointAt(sim.track, entry.distance + metersToSimUnits(1));
  const movedPosition = offsetTrackPoint(movedEntry, 0);
  sim.setCarState(car.id, {
    x: movedPosition.x,
    y: movedPosition.y,
    heading: movedEntry.heading,
    speed: 0,
    progress: movedEntry.distance,
    raceDistance: movedEntry.distance,
  });
  const movedCenterState = queryRunoffTrackStateForCar(sim.track, car).state;
  car.wheelSurfaceCache = null;
  applyWheelSurfaceState(car, sim.track, { centerState: movedCenterState, cacheAsAuto: true });
  const currentGeometryContainersReusedOnPoseChange = car.currentGeometryState === initialCurrentGeometryState &&
    car.currentGeometryState?.body === initialCurrentBody &&
    car.currentGeometryState?.wheels?.[0] === initialCurrentWheel &&
    (car.currentGeometryState?.wheels?.[0]?.corners?.[0] ?? null) === initialCurrentCorner;
  const currentGeometryStateHasNoHotSignatures = !Object.hasOwn(car.currentGeometryState ?? {}, 'currentSignature') &&
    !Object.hasOwn(car.currentGeometryState ?? {}, 'signature');

  resetTrackQueryStats(sim.track);
  let fullSamples = 0;
  let connectorAnalyticSamples = 0;
  let firstWheelStates = null;
  let firstSampledStates = null;
  let firstTrackState = null;
  let firstTrackLimitState = null;
  let firstWheelSummary = null;
  let firstConnectorQueriedStates = null;
  let firstConnectorQueriedStateObjects = null;
  let firstConnectorProjections = null;
  let firstConnectorProjectionObjects = null;
  let wheelContainersReused = true;
  let wheelSampleStateObjectsReused = true;
  let trackStateObjectReused = true;
  let trackLimitStateObjectReused = true;
  let wheelSummaryContainerReused = true;
  let trackLimitStateFromSummary = true;
  let connectorQueriedStateObjectsReused = true;
  let connectorProjectionObjectsReused = true;
  for (let iteration = 0; iteration < profile.wheelIterations; iteration += 1) {
    car.wheelSurfaceCache = null;
    const result = applyWheelSurfaceState(car, sim.track, { centerState, cacheAsAuto: true });
    if (result.sampleMode === 'full') fullSamples += 1;
    if (result.sampleMode === 'connector-analytic') connectorAnalyticSamples += 1;
    if (!firstWheelStates) {
      firstWheelStates = car.wheelStates;
      firstSampledStates = car.wheelStates.map((wheel) => wheel.sampledStates[0]);
      firstTrackState = car.trackState;
      firstTrackLimitState = car.trackLimitState;
      firstWheelSummary = car.wheelSurfaceScratch?.summary ?? null;
      firstConnectorQueriedStates = car.wheelSurfaceScratch?.connectorQueriedStatePools ?? null;
      firstConnectorQueriedStateObjects = firstConnectorQueriedStates?.map((state) => state) ?? null;
      firstConnectorProjections = car.wheelSurfaceScratch?.connectorProjectionPools ?? null;
      firstConnectorProjectionObjects = firstConnectorProjections?.map((projection) => projection) ?? null;
    } else if (
      car.wheelStates !== firstWheelStates ||
      car.wheelStates.length !== firstWheelStates.length ||
      car.wheelStates.some((wheel, index) => wheel !== firstWheelStates[index])
    ) {
      wheelContainersReused = false;
    }
    if (
      !firstSampledStates ||
      car.wheelStates.length !== firstSampledStates.length ||
      car.wheelStates.some((wheel, index) => wheel.sampledStates[0] !== firstSampledStates[index])
    ) {
      wheelSampleStateObjectsReused = false;
    }
    if (car.trackState !== firstTrackState) {
      trackStateObjectReused = false;
    }
    if (car.trackLimitState !== firstTrackLimitState) {
      trackLimitStateObjectReused = false;
    }
    if (car.wheelSurfaceScratch?.summary !== firstWheelSummary) {
      wheelSummaryContainerReused = false;
    }
    if (car.trackLimitState !== car.wheelSurfaceScratch?.summary?.trackLimits) {
      trackLimitStateFromSummary = false;
    }
    if (
      firstConnectorQueriedStates &&
      (
        car.wheelSurfaceScratch?.connectorQueriedStatePools !== firstConnectorQueriedStates ||
        car.wheelSurfaceScratch.connectorQueriedStatePools.length !== firstConnectorQueriedStateObjects.length ||
        car.wheelSurfaceScratch.connectorQueriedStatePools.some((state, index) => state !== firstConnectorQueriedStateObjects[index])
      )
    ) {
      connectorQueriedStateObjectsReused = false;
    }
    if (
      firstConnectorProjections &&
      (
        car.wheelSurfaceScratch?.connectorProjectionPools !== firstConnectorProjections ||
        car.wheelSurfaceScratch.connectorProjectionPools.length !== firstConnectorProjectionObjects.length ||
        car.wheelSurfaceScratch.connectorProjectionPools.some((projection, index) => projection !== firstConnectorProjectionObjects[index])
      )
    ) {
      connectorProjectionObjectsReused = false;
    }
  }
  const stats = snapshotTrackQueryStats(sim.track);
  return {
    operations: profile.wheelIterations,
    checks: {
      wheelIterations: profile.wheelIterations,
      fullSamples,
      connectorAnalyticSamples,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      hintedArcQueries: stats?.hintedArcQueries ?? 0,
      segmentNeighborhoodQueries: stats?.segmentNeighborhoodQueries ?? 0,
      segmentNeighborhoodBatchCalls: stats?.segmentNeighborhoodBatchCalls ?? 0,
      pitQueries: stats?.pitQueries ?? 0,
      pitBoxGridMisses: stats?.pitPaths?.['box-grid-miss'] ?? 0,
      connectorQueriedStatePoolLength: car.wheelSurfaceScratch?.connectorQueriedStatePools?.length ?? 0,
      wheelContainersReused,
      wheelSampleStateObjectsReused,
      trackStateObjectReused,
      trackLimitStateObjectReused,
      wheelSummaryContainerReused,
      trackLimitStateFromSummary,
      connectorQueriedStateObjectsReused,
      connectorProjectionObjectsReused,
      currentGeometryStateReusedOnPreviousPoseOnly,
      currentGeometryContainersReusedOnPoseChange,
      currentGeometryStateHasNoHotSignatures,
    },
  };
}

function benchmarkMainTrackWheelSurface(profile) {
  const sim = createBenchmarkSimulation({ driverCount: 1, physicsMode: 'advanced' });
  const car = sim.cars[0];
  const centerPoint = pointAt(sim.track, metersToSimUnits(4000));
  let centerState = nearestTrackState(sim.track, centerPoint, centerPoint.distance);
  sim.setCarState(car.id, {
    x: centerPoint.x,
    y: centerPoint.y,
    heading: centerPoint.heading,
    speed: 0,
    progress: centerPoint.distance,
    raceDistance: centerPoint.distance,
  });

  applyWheelSurfaceState(car, sim.track, { centerState });
  const prePhysicsCurrentGeometryState = car.currentGeometryState;
  car.previousX = car.x - metersToSimUnits(4);
  car.previousY = car.y + metersToSimUnits(1.5);
  car.previousHeading = car.heading + 0.08;
  applyWheelSurfaceState(car, sim.track, { centerState });
  const currentGeometryStateReusedOnPreviousPoseOnly = car.currentGeometryState === prePhysicsCurrentGeometryState;
  const initialCurrentGeometryState = car.currentGeometryState;
  const initialCurrentBody = initialCurrentGeometryState?.body ?? null;
  const initialCurrentWheel = initialCurrentGeometryState?.wheels?.[0] ?? null;
  const initialCurrentCorner = initialCurrentWheel?.corners?.[0] ?? null;
  const movedCenterPoint = pointAt(sim.track, centerPoint.distance + metersToSimUnits(1));
  centerState = nearestTrackState(sim.track, movedCenterPoint, movedCenterPoint.distance);
  sim.setCarState(car.id, {
    x: movedCenterPoint.x,
    y: movedCenterPoint.y,
    heading: movedCenterPoint.heading,
    speed: 0,
    progress: movedCenterPoint.distance,
    raceDistance: movedCenterPoint.distance,
  });
  car.wheelSurfaceCache = null;
  applyWheelSurfaceState(car, sim.track, { centerState });
  const currentGeometryContainersReusedOnPoseChange = car.currentGeometryState === initialCurrentGeometryState &&
    car.currentGeometryState?.body === initialCurrentBody &&
    car.currentGeometryState?.wheels?.[0] === initialCurrentWheel &&
    (car.currentGeometryState?.wheels?.[0]?.corners?.[0] ?? null) === initialCurrentCorner;
  const currentGeometryStateHasNoHotSignatures = !Object.hasOwn(car.currentGeometryState ?? {}, 'currentSignature') &&
    !Object.hasOwn(car.currentGeometryState ?? {}, 'signature');

  resetTrackQueryStats(sim.track);
  let analyticSamples = 0;
  let firstWheels = null;
  let firstSampledStates = null;
  let firstTrackState = null;
  let firstTrackLimitState = null;
  let firstWheelSummary = null;
  let wheelContainersReused = true;
  let wheelSampleStateObjectsReused = true;
  let trackStateObjectReused = true;
  let trackLimitStateObjectReused = true;
  let wheelSummaryContainerReused = true;
  let trackLimitStateFromSummary = true;
  for (let iteration = 0; iteration < profile.wheelIterations; iteration += 1) {
    car.wheelSurfaceCache = null;
    const result = applyWheelSurfaceState(car, sim.track, { centerState });
    if (result.sampleMode === 'analytic') analyticSamples += 1;
    if (!firstWheels) {
      firstWheels = car.wheelStates;
      firstSampledStates = car.wheelStates.map((wheel) => wheel.sampledStates[0]);
      firstTrackState = car.trackState;
      firstTrackLimitState = car.trackLimitState;
      firstWheelSummary = car.wheelSurfaceScratch?.summary ?? null;
    } else if (
      car.wheelStates !== firstWheels ||
      car.wheelStates.length !== firstWheels.length ||
      car.wheelStates.some((wheel, index) => wheel !== firstWheels[index])
    ) {
      wheelContainersReused = false;
    }
    if (
      !firstSampledStates ||
      car.wheelStates.length !== firstSampledStates.length ||
      car.wheelStates.some((wheel, index) => wheel.sampledStates[0] !== firstSampledStates[index])
    ) {
      wheelSampleStateObjectsReused = false;
    }
    if (car.trackState !== firstTrackState) {
      trackStateObjectReused = false;
    }
    if (car.trackLimitState !== firstTrackLimitState) {
      trackLimitStateObjectReused = false;
    }
    if (car.wheelSurfaceScratch?.summary !== firstWheelSummary) {
      wheelSummaryContainerReused = false;
    }
    if (car.trackLimitState !== car.wheelSurfaceScratch?.summary?.trackLimits) {
      trackLimitStateFromSummary = false;
    }
  }
  const stats = snapshotTrackQueryStats(sim.track);
  return {
    operations: profile.wheelIterations,
    checks: {
      wheelIterations: profile.wheelIterations,
      analyticSamples,
      fullSamples: 0,
      nearestQueries: stats?.nearestQueries ?? 0,
      nearestFallbacks: stats?.nearestFallbacks ?? 0,
      hintedArcQueries: stats?.hintedArcQueries ?? 0,
      segmentNeighborhoodQueries: stats?.segmentNeighborhoodQueries ?? 0,
      segmentNeighborhoodBatchCalls: stats?.segmentNeighborhoodBatchCalls ?? 0,
      pitQueries: stats?.pitQueries ?? 0,
      pitBoxGridMisses: stats?.pitPaths?.['box-grid-miss'] ?? 0,
      wheelContainersReused,
      wheelSampleStateObjectsReused,
      trackStateObjectReused,
      trackLimitStateObjectReused,
      wheelSummaryContainerReused,
      trackLimitStateFromSummary,
      currentGeometryStateReusedOnPreviousPoseOnly,
      currentGeometryContainersReusedOnPoseChange,
      currentGeometryStateHasNoHotSignatures,
    },
  };
}

function benchmarkEnvironmentStep(profileName, profile) {
  const environmentOptions = createRuntimeBenchmarkEnvironmentOptions({
    profile: profileName,
    driverCount: profileName === 'smoke' ? 6 : 20,
    frameSkip: 4,
  });
  const env = createPaddockEnvironment(environmentOptions);
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
  const observationScratch = {};
  const observationSnapshot = env.getState({ output: 'minimal' }).snapshot;
  buildEnvironmentObservation({
    snapshot: observationSnapshot,
    options: environmentOptions,
    events: [],
    controlledDrivers: ids,
    scratch: observationScratch,
  });
  const firstCarsById = observationScratch.carsById;
  buildEnvironmentObservation({
    snapshot: observationSnapshot,
    options: environmentOptions,
    events: [],
    controlledDrivers: ids,
    scratch: observationScratch,
  });
  const observationCarsByIdMapReused = observationScratch.carsById === firstCarsById;
  const observationEventsByDriverSkippedWithoutEvents = observationScratch.eventsByDriver == null;
  const metricScratch = {};
  buildDriverMetrics({
    snapshot: observationSnapshot,
    previousSnapshot: observationSnapshot,
    options: { ...environmentOptions, controlledDrivers: ids },
    events: [],
    scratch: metricScratch,
  });
  const firstPreviousCarsById = metricScratch.previousCarsById;
  const firstCurrentCarsById = metricScratch.currentCarsById;
  buildDriverMetrics({
    snapshot: observationSnapshot,
    previousSnapshot: observationSnapshot,
    options: { ...environmentOptions, controlledDrivers: ids },
    events: [],
    scratch: metricScratch,
  });
  const metricsPreviousCarsByIdMapReused = metricScratch.previousCarsById === firstPreviousCarsById;
  const metricsCurrentCarsByIdMapReused = metricScratch.currentCarsById === firstCurrentCarsById;
  const metricsContactCountsSkippedWithoutEvents = metricScratch.contactCounts == null;
  env.destroy();
  return {
    operations: profile.environmentSteps * ids.length * 4,
    checks: {
      steps: profile.environmentSteps,
      controlledDrivers: ids.length,
      vectorObservations: vectorLengths.filter((length) => length > 0).length,
      minVectorLength: Math.min(...vectorLengths),
      stateIsNull: result.state === null,
      observationCarsByIdMapReused,
      observationEventsByDriverSkippedWithoutEvents,
      metricsPreviousCarsByIdMapReused,
      metricsCurrentCarsByIdMapReused,
      metricsContactCountsSkippedWithoutEvents,
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
  const serializedTrack = JSON.parse(JSON.stringify(full.track));
  const fullTrackBytesPerSnapshot = JSON.stringify(serializedTrack).length;
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
      fullBytesPerSnapshot: fullBytes / profile.snapshotIterations,
      fullTrackBytesPerSnapshot,
      fullTrackUsesSampleSchema: Array.isArray(serializedTrack.sampleSchema),
      fullTrackSampleSchemaLength: serializedTrack.sampleSchema?.length ?? 0,
      fullTrackSamplesUseArrays: Array.isArray(serializedTrack.samples?.[0]),
      fullTrackPitBoxesDropTeamMetadata: !Object.hasOwn(serializedTrack.pitLane?.boxes?.[0] ?? {}, 'teamName') &&
        !Object.hasOwn(serializedTrack.pitLane?.boxes?.[0] ?? {}, 'teamColor') &&
        !Object.hasOwn(serializedTrack.pitLane?.boxes?.[0] ?? {}, 'teamId'),
      renderBytes,
      renderBytesPerSnapshot: renderBytes / profile.snapshotIterations,
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
      compactVectorsAligned: Array.isArray(compactPayload.vectors) && compactPayload.vectors.length === driverIds.length,
      compactPreviousActionsAligned: Array.isArray(compactPayload.previousActions) && compactPayload.previousActions.length === driverIds.length,
      compactMetricsAligned: Array.isArray(compactPayload.metrics) && compactPayload.metrics.length === driverIds.length,
      compactRepeatsSpecs: Object.hasOwn(compactPayload, 'observationSpec') || Object.hasOwn(compactPayload, 'actionSpec'),
      resetHasSpecs: Object.hasOwn(resetPayload, 'observationSpec') && Object.hasOwn(resetPayload, 'actionSpec'),
      resetHasCompactFields: Array.isArray(resetPayload.previousActionFields) && Array.isArray(resetPayload.metricFields),
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
    track.width / 2 + track.kerbWidth + track.gravelWidth + track.runoffWidth + metersToSimUnits(6),
  ];
  const baseQueries = Array.from({ length: 240 }, (_, index) => {
    const distance = (track.length * index) / 240;
    const center = pointAt(track, distance);
    return offsets.map((offset) => ({
      position: offsetTrackPoint(center, offset),
      progressHint: center.distance,
    }));
  }).flat();
  const pitLane = track.pitLane;
  const pitQueries = !pitLane?.enabled ? [] : [
    pitLane.entry.roadCenterline[Math.floor(pitLane.entry.roadCenterline.length / 2)],
    pitLane.mainLane.points[Math.floor(pitLane.mainLane.points.length / 2)],
    ...(pitLane.workingLane?.points?.length ? [pitLane.workingLane.points[Math.floor(pitLane.workingLane.points.length / 2)]] : []),
    pitLane.exit.roadCenterline[Math.floor(pitLane.exit.roadCenterline.length / 2)],
    pitLane.boxes[0]?.center,
    pitLane.serviceAreas[0]?.center,
  ]
    .filter(Boolean)
    .map((point) => ({
      position: point,
      progressHint: point.distance ?? null,
    }));
  return [...baseQueries, ...pitQueries];
}

function precomputePitRoadQueries(track) {
  const pitLane = track.pitLane;
  if (!pitLane?.enabled) return [];
  const laneEntryDistance = pitLane.layout?.entryDistance ?? pitLane.entry.distanceFromStart;
  const laneExitDistance = pitLane.layout?.exitDistance ?? pitLane.exit.distanceFromStart;
  return [
    {
      position: pitLane.entry.roadCenterline[Math.floor(pitLane.entry.roadCenterline.length / 2)],
      progressHint: pitLane.entry.trackDistance,
    },
    {
      position: pitLane.mainLane.points[Math.floor(pitLane.mainLane.points.length / 2)],
      progressHint: laneEntryDistance,
    },
    ...(pitLane.workingLane?.points?.length ? [{
      position: pitLane.workingLane.points[Math.floor(pitLane.workingLane.points.length / 2)],
      progressHint: laneEntryDistance,
    }] : []),
    {
      position: pitLane.exit.roadCenterline[Math.floor(pitLane.exit.roadCenterline.length / 2)],
      progressHint: laneExitDistance,
    },
  ].filter((query) => query.position);
}

function pitRoutesHavePrecomputedDistances(track) {
  const pitLane = track?.pitLane;
  const routes = track?.queryIndex?.pit?.routes;
  if (!pitLane?.enabled || !routes) return false;
  return [
    ['entry', pitLane.entry?.roadCenterline],
    ['main', pitLane.mainLane?.points],
    ['working', pitLane.workingLane?.points],
    ['exit', pitLane.exit?.roadCenterline],
  ].every(([routeId, points]) => {
    if (!Array.isArray(points) || points.length < 2) return true;
    const distances = routes[routeId]?.cumulativeDistances;
    if (!Array.isArray(distances) || distances.length !== points.length || distances[0] !== 0) return false;
    const expectedLength = routeLength(points);
    const actualLength = distances[distances.length - 1];
    return Math.abs(actualLength - expectedLength) < 1e-6;
  });
}

function routeLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function precomputeHintedQueries(track) {
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
  if (benchmark.name === 'timing history and line maintenance') {
    requirePositive(checks.steps, benchmark, 'steps');
    requirePositive(checks.cars, benchmark, 'cars');
    requireAtMost(checks.activeHistorySamplesMax, TIMING_HISTORY_MAX_SAMPLES, benchmark, 'activeHistorySamplesMax');
    requireAtMost(checks.storedHistorySamplesMax, TIMING_HISTORY_MAX_SAMPLES + 64, benchmark, 'storedHistorySamplesMax');
    requirePositive(checks.lineStoredSpanMax, benchmark, 'lineStoredSpanMax');
    requireAtMost(checks.lineStoredSpanMax, checks.maxAllowedLineSpan + 4, benchmark, 'lineStoredSpanMax');
    requirePositive(checks.carsWithPrunedTimingLines, benchmark, 'carsWithPrunedTimingLines');
    requirePositive(checks.directSegmentCacheHits, benchmark, 'directSegmentCacheHits');
    requirePositive(checks.zeroTravelCalls, benchmark, 'zeroTravelCalls');
    requireEqual(checks.zeroTravelOwnKeysCalls, 0, benchmark, 'zeroTravelOwnKeysCalls');
  } else if (benchmark.name === 'timing-line gap without stored crossings') {
    requirePositive(checks.iterations, benchmark, 'iterations');
    requireEqual(checks.noStoredTimingLineNumericGets, 0, benchmark, 'noStoredTimingLineNumericGets');
  } else if (benchmark.name === 'lap telemetry in-progress sync') {
    requirePositive(checks.iterations, benchmark, 'iterations');
    requirePositive(checks.cars, benchmark, 'cars');
    requireEqual(checks.sectorArraysReused, true, benchmark, 'sectorArraysReused');
    requireEqual(checks.noBoundaryCrosses, true, benchmark, 'noBoundaryCrosses');
  } else if (benchmark.category === 'pit-lane-transition') {
    requirePositive(checks.iterations, benchmark, 'iterations');
    requirePositive(checks.routeSegments, benchmark, 'routeSegments');
    requireEqual(checks.sampleRouteIntoCalls, checks.iterations, benchmark, 'sampleRouteIntoCalls');
    requireEqual(checks.sampleRouteAllocations, 0, benchmark, 'sampleRouteAllocations');
    requireEqual(checks.segmentFallbackScans, 0, benchmark, 'segmentFallbackScans');
    requireTrue(checks.sampleContainerReused, benchmark, 'sampleContainerReused');
    requireTrue(checks.projectionScratchReused, benchmark, 'projectionScratchReused');
    requirePositive(checks.limiterActiveSamples, benchmark, 'limiterActiveSamples');
    requirePositive(checks.finiteLimiterDistances, benchmark, 'finiteLimiterDistances');
  } else if (benchmark.category === 'simulation') {
    requirePositive(checks.steps, benchmark, 'steps');
    requirePositive(checks.cars, benchmark, 'cars');
    requirePositive(checks.elapsedSeconds, benchmark, 'elapsedSeconds');
    requireEqual(checks.broadCommitsPerStep, 1, benchmark, 'broadCommitsPerStep');
    requireEqual(checks.broadCommitSurfaceRefreshSkips, checks.broadRaceStateCommits, benchmark, 'broadCommitSurfaceRefreshSkips');
    requireEqual(checks.broadCommitDrsFieldScans, 0, benchmark, 'broadCommitDrsFieldScans');
    requireEqual(checks.broadCommitDrsReferenceScratchBuilds, checks.broadRaceStateCommits, benchmark, 'broadCommitDrsReferenceScratchBuilds');
    requirePositive(checks.broadCommitDrsReferenceFullFieldFastPathCalls, benchmark, 'broadCommitDrsReferenceFullFieldFastPathCalls');
    requirePositive(checks.broadCommitDrsReferenceOrderedFastPathCalls, benchmark, 'broadCommitDrsReferenceOrderedFastPathCalls');
    requireAtMost(checks.broadCommitDrsNextZoneScans, checks.cars, benchmark, 'broadCommitDrsNextZoneScans');
    requirePositive(checks.broadCommitDrsNextZoneCacheHits, benchmark, 'broadCommitDrsNextZoneCacheHits');
    requirePositive(checks.broadCommitDrsNextZoneFastPathChecks, benchmark, 'broadCommitDrsNextZoneFastPathChecks');
    requireAtMost(checks.broadCommitDrsNextZoneFastPathChecks, checks.broadCommitDrsNextZoneCacheHits, benchmark, 'broadCommitDrsNextZoneFastPathChecks');
    requireEqual(checks.broadCommitAggressionFieldScans, 0, benchmark, 'broadCommitAggressionFieldScans');
    requireEqual(checks.broadCommitFinishEvalOrderedScans, 0, benchmark, 'broadCommitFinishEvalOrderedScans');
    requirePositive(checks.broadCommitFinishEvalNoFinishFastPathCalls, benchmark, 'broadCommitFinishEvalNoFinishFastPathCalls');
    requireEqual(checks.broadCommitExcludedCarResetScans, 0, benchmark, 'broadCommitExcludedCarResetScans');
    requireEqual(checks.broadCommitExcludedCarResetSkips, checks.broadRaceStateCommits, benchmark, 'broadCommitExcludedCarResetSkips');
    requireEqual(checks.broadCommitTimingStateUpdates, checks.steps * checks.cars, benchmark, 'broadCommitTimingStateUpdates');
    requirePositive(checks.broadCommitLeaderGapAccumulated, benchmark, 'broadCommitLeaderGapAccumulated');
    requireEqual(checks.broadCommitLeaderGapFallbackEstimates, 0, benchmark, 'broadCommitLeaderGapFallbackEstimates');
    requirePositive(checks.sectorPerformanceRebuilds, benchmark, 'sectorPerformanceRebuilds');
    requirePositive(checks.sectorPerformanceSkippedRebuilds, benchmark, 'sectorPerformanceSkippedRebuilds');
    requireAtMost(checks.sectorPerformanceUpdatedCars, checks.cars, benchmark, 'sectorPerformanceUpdatedCars');
    requireTrue(checks.telemetryBuffersReused, benchmark, 'telemetryBuffersReused');
  } else if (benchmark.category === 'simulation-phases') {
    requirePositive(checks.steps, benchmark, 'steps');
    requirePhase(checks, benchmark, 'prePhysicsWheelSurface');
    requirePhase(checks, benchmark, 'runoffResponse');
    requirePhase(checks, benchmark, 'localSurfaceRefresh');
    requirePhase(checks, benchmark, 'broadRaceCommit');
    requireEqual(checks.broadCommitCalls, checks.steps, benchmark, 'broadCommitCalls');
    requireEqual(checks.broadCommitNearestQueries, 0, benchmark, 'broadCommitNearestQueries');
    requireEqual(checks.runoffNearestQueries, 0, benchmark, 'runoffNearestQueries');
    requireEqual(checks.runoffHintedArcQueries, 0, benchmark, 'runoffHintedArcQueries');
    requirePositive(checks.runoffSegmentNeighborhoodQueries, benchmark, 'runoffSegmentNeighborhoodQueries');
    requirePositive(checks.runoffRadius1Queries, benchmark, 'runoffRadius1Queries');
    requireEqual(checks.localRefreshNearestQueries, 0, benchmark, 'localRefreshNearestQueries');
    requireEqual(checks.localRefreshHintedArcQueries, 0, benchmark, 'localRefreshHintedArcQueries');
    requireAtMost(checks.localRefreshSegmentNeighborhoodQueries, 748, benchmark, 'localRefreshSegmentNeighborhoodQueries');
    requireAtMost(checks.localRefreshSegmentNeighborhoodBatchCalls, 187, benchmark, 'localRefreshSegmentNeighborhoodBatchCalls');
  } else if (benchmark.category === 'collision') {
    requirePositive(checks.candidatePairs, benchmark, 'candidatePairs');
    requirePositive(checks.collisions, benchmark, 'collisions');
    requirePositive(checks.sweptCollisions, benchmark, 'sweptCollisions');
    requireTrue(checks.reusedCandidateArray, benchmark, 'reusedCandidateArray');
    requireTrue(checks.reusedProjectionScratch, benchmark, 'reusedProjectionScratch');
    requireTrue(checks.reusedSweepScratch, benchmark, 'reusedSweepScratch');
    requireTrue(checks.reusedCollisionResult, benchmark, 'reusedCollisionResult');
    requireTrue(checks.reusedCollisionAxis, benchmark, 'reusedCollisionAxis');
    requireTrue(checks.reusedShapeCollisionResult, benchmark, 'reusedShapeCollisionResult');
    requireTrue(checks.reusedShapeCollisionAxis, benchmark, 'reusedShapeCollisionAxis');
    requireEqual(checks.contactVelocityResponses, checks.iterations, benchmark, 'contactVelocityResponses');
    requireEqual(checks.contactVelocityVectorObjectAllocations, 0, benchmark, 'contactVelocityVectorObjectAllocations');
    requireTrue(checks.collisionCandidatePairMarksReused, benchmark, 'collisionCandidatePairMarksReused');
    requireEqual(checks.collisionCandidateKeysSetAllocated, false, benchmark, 'collisionCandidateKeysSetAllocated');
    requireEqual(checks.collisionCarOrderMapAllocated, false, benchmark, 'collisionCarOrderMapAllocated');
    requireEqual(checks.collisionMissingDistanceSetAllocated, false, benchmark, 'collisionMissingDistanceSetAllocated');
    requireTrue(checks.collisionDistanceEntryPoolReused, benchmark, 'collisionDistanceEntryPoolReused');
    requireTrue(checks.collisionMissingDistanceFlagsReused, benchmark, 'collisionMissingDistanceFlagsReused');
    requireTrue(checks.collisionMissingDistanceIndexesReused, benchmark, 'collisionMissingDistanceIndexesReused');
    requireTrue(checks.collisionCollidableCarsReused, benchmark, 'collisionCollidableCarsReused');
    requireTrue(checks.collisionReportedContactMarksReused, benchmark, 'collisionReportedContactMarksReused');
    requireEqual(checks.collisionReportedContactsSetAllocated, false, benchmark, 'collisionReportedContactsSetAllocated');
    requireTrue(checks.collisionStewardContextReused, benchmark, 'collisionStewardContextReused');
    requirePositive(checks.collisionStewardReviews, benchmark, 'collisionStewardReviews');
    requireEqual(checks.collisionStewardPenaltyArrayAllocations, 0, benchmark, 'collisionStewardPenaltyArrayAllocations');
  } else if (benchmark.category === 'track-query') {
    requirePositive(checks.nearestQueries, benchmark, 'nearestQueries');
    requirePositive(checks.hintDistanceCacheHits, benchmark, 'hintDistanceCacheHits');
    requirePositive(checks.precomputedSegmentNeighborhoodHits, benchmark, 'precomputedSegmentNeighborhoodHits');
    requireTrue(checks.nearestProjectionScratchReused, benchmark, 'nearestProjectionScratchReused');
    requireTrue(checks.precomputedSegmentProjectionScalars, benchmark, 'precomputedSegmentProjectionScalars');
    requirePositive(checks.nearestEmptyCellSkippedRings, benchmark, 'nearestEmptyCellSkippedRings');
    requirePositive(checks.nearestIsolatedHintQueries, benchmark, 'nearestIsolatedHintQueries');
    requirePositive(checks.nearestLowDensityHintQueries, benchmark, 'nearestLowDensityHintQueries');
    requirePositive(checks.nearestLowDensityCellExactQueries, benchmark, 'nearestLowDensityCellExactQueries');
    requirePositive(checks.nearestLowDensityCellDirectQueries, benchmark, 'nearestLowDensityCellDirectQueries');
    requirePositive(checks.nearestSparseGridExactQueries, benchmark, 'nearestSparseGridExactQueries');
    requirePositive(checks.nearestRing2NeighborhoodExactQueries, benchmark, 'nearestRing2NeighborhoodExactQueries');
    requirePositive(checks.arcBucketRadius2PrecomputedQueries, benchmark, 'arcBucketRadius2PrecomputedQueries');
    requirePositive(checks.hintedSegmentFastPathQueries, benchmark, 'hintedSegmentFastPathQueries');
    requirePositive(checks.hintedSegmentWideRadiusQueries, benchmark, 'hintedSegmentWideRadiusQueries');
    requirePositive(checks.hintedSegmentWideRadiusHits, benchmark, 'hintedSegmentWideRadiusHits');
    requirePositive(checks.pitQueries, benchmark, 'pitQueries');
    requirePositive(checks.trackQueryIterations, benchmark, 'trackQueryIterations');
    requirePositive(checks.pitOverrideMainRoadSkips, benchmark, 'pitOverrideMainRoadSkips');
    requirePositive(checks.pitConnectorDirectStateHits, benchmark, 'pitConnectorDirectStateHits');
    requirePositive(checks.pitConnectorDirectSkips, benchmark, 'pitConnectorDirectSkips');
    requireTrue(checks.pitConnectorProjectionScratchReused, benchmark, 'pitConnectorProjectionScratchReused');
    requirePositive(
      checks.pitConnectorEndpointWindowProjectionCalls,
      benchmark,
      'pitConnectorEndpointWindowProjectionCalls',
    );
    requireEqual(checks.pitConnectorFullRouteProjectionScans, 0, benchmark, 'pitConnectorFullRouteProjectionScans');
    requirePositive(checks.pitRoadQueryPoints, benchmark, 'pitRoadQueryPoints');
    requireEqual(checks.pitRoadQueryCalls, checks.pitRoadQueryPoints * checks.trackQueryIterations, benchmark, 'pitRoadQueryCalls');
    requireAtMost(checks.pitQueries, checks.trackQueryIterations * (checks.pitRoadQueryPoints + 2), benchmark, 'pitQueries');
    requirePositive(checks.pitRoadGridHits, benchmark, 'pitRoadGridHits');
    requireEqual(checks.pitRoadGridMisses, 0, benchmark, 'pitRoadGridMisses');
    requireTrue(checks.pitRoadProjectionScratchReused, benchmark, 'pitRoadProjectionScratchReused');
    requireTrue(checks.pitRoadPrecomputedRouteDistances, benchmark, 'pitRoadPrecomputedRouteDistances');
    requireEqual(checks.pitRoadCumulativeDistanceRebuilds, 0, benchmark, 'pitRoadCumulativeDistanceRebuilds');
    requireEqual(checks.candidateProjectionObjectAllocations, 0, benchmark, 'candidateProjectionObjectAllocations');
    requireEqual(checks.segmentNeighborhoodIdScratchLength, 0, benchmark, 'segmentNeighborhoodIdScratchLength');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
    requireEqual(checks.pitFallbacks, 0, benchmark, 'pitFallbacks');
    requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
    requireEqual(
      (checks.hintedSegmentFastPathQueries ?? 0) + (checks.hintedSegmentWideRadiusQueries ?? 0),
      checks.hintedQueryCalls,
      benchmark,
      'hintedSegmentFastPathQueries',
    );
  } else if (benchmark.category === 'sensor-rays') {
    requirePositive(checks.rayCount, benchmark, 'rayCount');
    requirePositive(checks.hitCount, benchmark, 'hitCount');
    requirePositive(checks.directPathCount, benchmark, 'directPathCount');
    requireEqual(checks.directPathCount, checks.rayCount, benchmark, 'directPathCount');
    requireEqual(checks.sampledPathCount, 0, benchmark, 'sampledPathCount');
    requireEqual(checks.fallbackCount, 0, benchmark, 'fallbackCount');
    requireEqual(checks.nearestQueries, 0, benchmark, 'nearestQueries');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
    requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
    requireEqual(checks.raySegmentObjectAllocations, 0, benchmark, 'raySegmentObjectAllocations');
    requireEqual(checks.rayChannelSetAllocations, 0, benchmark, 'rayChannelSetAllocations');
    requireEqual(checks.carRayCallerVectorCount, checks.rayCount, benchmark, 'carRayCallerVectorCount');
    requireEqual(checks.carRayComputedVectorCount, 0, benchmark, 'carRayComputedVectorCount');
    requireEqual(checks.carRayResultTargetCount, checks.rayCount, benchmark, 'carRayResultTargetCount');
    requireTrue(checks.rayTargetContainersReused, benchmark, 'rayTargetContainersReused');
    requireTrue(checks.rayFilteredCarTargetContainersReused, benchmark, 'rayFilteredCarTargetContainersReused');
    requireTrue(checks.rayOptionsNormalizedReused, benchmark, 'rayOptionsNormalizedReused');
    requireAtMost(checks.segmentNeighborhoodQueries, checks.rayCount, benchmark, 'segmentNeighborhoodQueries');
    requireTrue(checks.rayContainersReused, benchmark, 'rayContainersReused');
    requireTrue(checks.rayChannelContainersReused, benchmark, 'rayChannelContainersReused');
    requireTrue(checks.rayChannelFlagContainersReused, benchmark, 'rayChannelFlagContainersReused');
    requireTrue(checks.rayBoundaryContainersMaterialized, benchmark, 'rayBoundaryContainersMaterialized');
    requireTrue(checks.rayBoundaryContainersReused, benchmark, 'rayBoundaryContainersReused');
    requireTrue(checks.rayBoundaryDistanceArraysReused, benchmark, 'rayBoundaryDistanceArraysReused');
    requireTrue(checks.rayTracePointReused, benchmark, 'rayTracePointReused');
  } else if (benchmark.category === 'sensor-surface-rays') {
    requirePositive(checks.rayCount, benchmark, 'rayCount');
    requirePositive(checks.hitCount, benchmark, 'hitCount');
    requireEqual(checks.directPathCount, checks.rayCount, benchmark, 'directPathCount');
    requireEqual(checks.sampledPathCount, 0, benchmark, 'sampledPathCount');
    requireEqual(checks.fallbackCount, 0, benchmark, 'fallbackCount');
    requireEqual(checks.nearestQueries, 0, benchmark, 'nearestQueries');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
    requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
    requireEqual(checks.raySegmentObjectAllocations, 0, benchmark, 'raySegmentObjectAllocations');
    requireAtMost(checks.segmentNeighborhoodQueries, checks.rayCount, benchmark, 'segmentNeighborhoodQueries');
    requireTrue(checks.traceResultContainersReused, benchmark, 'traceResultContainersReused');
    requireTrue(checks.traceResultChannelObjectsReused, benchmark, 'traceResultChannelObjectsReused');
    requireTrue(checks.surfaceBoundaryContainersReused, benchmark, 'surfaceBoundaryContainersReused');
    requireTrue(checks.surfaceBoundaryDistanceArraysReused, benchmark, 'surfaceBoundaryDistanceArraysReused');
    requireTrue(checks.rayTracePointReused, benchmark, 'rayTracePointReused');
  } else if (benchmark.category === 'sensor-ray-bands') {
    requirePositive(checks.rayCount, benchmark, 'rayCount');
    requirePositive(checks.hitCount, benchmark, 'hitCount');
    requireEqual(checks.directPathCount, checks.rayCount, benchmark, 'directPathCount');
    requireEqual(checks.sampledPathCount, 0, benchmark, 'sampledPathCount');
    requireEqual(checks.fallbackCount, 0, benchmark, 'fallbackCount');
    requireEqual(checks.nearestQueries, 0, benchmark, 'nearestQueries');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
    requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
    requireEqual(checks.raySegmentObjectAllocations, 0, benchmark, 'raySegmentObjectAllocations');
    requireEqual(checks.segmentNeighborhoodQueries, checks.rayCount * 3, benchmark, 'segmentNeighborhoodQueries');
    requireTrue(checks.rayTracePointReused, benchmark, 'rayTracePointReused');
  } else if (benchmark.name === 'sensor ray pit-lane direct boundary') {
    requirePositive(checks.rayCount, benchmark, 'rayCount');
    requirePositive(checks.hitCount, benchmark, 'hitCount');
    requireEqual(checks.directPathCount, checks.rayCount, benchmark, 'directPathCount');
    requireEqual(checks.sampledPathCount, 0, benchmark, 'sampledPathCount');
    requireEqual(checks.fallbackCount, 0, benchmark, 'fallbackCount');
    requireEqual(checks.nearestQueries, 0, benchmark, 'nearestQueries');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
    requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
    requireEqual(checks.raySegmentObjectAllocations, 0, benchmark, 'raySegmentObjectAllocations');
    requireEqual(checks.segmentNeighborhoodBatchCalls, 0, benchmark, 'segmentNeighborhoodBatchCalls');
  } else if (benchmark.category === 'sensor-ray-recovery') {
    requirePositive(checks.rayCount, benchmark, 'rayCount');
    requirePositive(checks.hitCount, benchmark, 'hitCount');
    requireEqual(checks.directPathCount, checks.rayCount, benchmark, 'directPathCount');
    requireEqual(checks.sampledPathCount, 0, benchmark, 'sampledPathCount');
    requireEqual(checks.fallbackCount, 0, benchmark, 'fallbackCount');
    requireEqual(checks.nearestQueries, 0, benchmark, 'nearestQueries');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
    requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
    requireEqual(checks.raySegmentObjectAllocations, 0, benchmark, 'raySegmentObjectAllocations');
    requireEqual(checks.segmentNeighborhoodQueries, checks.rayCount * 2, benchmark, 'segmentNeighborhoodQueries');
    requireEqual(checks.segmentNeighborhoodBatchCalls, 0, benchmark, 'segmentNeighborhoodBatchCalls');
    requireTrue(checks.rayTracePointReused, benchmark, 'rayTracePointReused');
  } else if (benchmark.category === 'wheel-surface') {
    requirePositive(checks.wheelIterations, benchmark, 'wheelIterations');
    requireEqual(checks.fullSamples, 0, benchmark, 'fullSamples');
    requireEqual(checks.nearestFallbacks, 0, benchmark, 'nearestFallbacks');
    requireTrue(checks.wheelContainersReused, benchmark, 'wheelContainersReused');
    requireTrue(checks.wheelSampleStateObjectsReused, benchmark, 'wheelSampleStateObjectsReused');
    requireTrue(checks.trackStateObjectReused, benchmark, 'trackStateObjectReused');
    requireTrue(checks.trackLimitStateObjectReused, benchmark, 'trackLimitStateObjectReused');
    requireTrue(checks.wheelSummaryContainerReused, benchmark, 'wheelSummaryContainerReused');
    requireTrue(checks.trackLimitStateFromSummary, benchmark, 'trackLimitStateFromSummary');
    requireTrue(checks.currentGeometryStateReusedOnPreviousPoseOnly, benchmark, 'currentGeometryStateReusedOnPreviousPoseOnly');
    requireTrue(checks.currentGeometryContainersReusedOnPoseChange, benchmark, 'currentGeometryContainersReusedOnPoseChange');
    requireTrue(checks.currentGeometryStateHasNoHotSignatures, benchmark, 'currentGeometryStateHasNoHotSignatures');
    if (benchmark.name === 'wheel surface main-track analytic') {
      requireEqual(checks.analyticSamples, checks.wheelIterations, benchmark, 'analyticSamples');
      requireEqual(checks.nearestQueries, 0, benchmark, 'nearestQueries');
      requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
      requireEqual(checks.segmentNeighborhoodQueries, 0, benchmark, 'segmentNeighborhoodQueries');
      requireEqual(checks.segmentNeighborhoodBatchCalls, 0, benchmark, 'segmentNeighborhoodBatchCalls');
      requireEqual(checks.pitQueries, 0, benchmark, 'pitQueries');
      requireEqual(checks.pitBoxGridMisses, 0, benchmark, 'pitBoxGridMisses');
    } else if (benchmark.name === 'wheel surface connector local-refresh path') {
      requireEqual(checks.connectorAnalyticSamples, checks.wheelIterations, benchmark, 'connectorAnalyticSamples');
      requireEqual(checks.nearestQueries, 0, benchmark, 'nearestQueries');
      requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
      requireEqual(checks.segmentNeighborhoodQueries, 0, benchmark, 'segmentNeighborhoodQueries');
      requireEqual(checks.segmentNeighborhoodBatchCalls, 0, benchmark, 'segmentNeighborhoodBatchCalls');
      requireEqual(checks.pitQueries, 0, benchmark, 'pitQueries');
      requireEqual(checks.pitBoxGridMisses, 0, benchmark, 'pitBoxGridMisses');
      requireEqual(checks.connectorQueriedStatePoolLength, 0, benchmark, 'connectorQueriedStatePoolLength');
      requireTrue(checks.connectorQueriedStateObjectsReused, benchmark, 'connectorQueriedStateObjectsReused');
      requireTrue(checks.connectorProjectionObjectsReused, benchmark, 'connectorProjectionObjectsReused');
    } else if (benchmark.name === 'wheel surface near pit connector') {
      requireEqual(checks.connectorAnalyticSamples, checks.wheelIterations, benchmark, 'connectorAnalyticSamples');
      requireEqual(
        checks.directCalculationConnectorAnalyticSamples,
        checks.wheelIterations,
        benchmark,
        'directCalculationConnectorAnalyticSamples',
      );
      requireEqual(
        checks.directCalculationScratchlessScalarWheelBatches,
        checks.wheelIterations,
        benchmark,
        'directCalculationScratchlessScalarWheelBatches',
      );
      requireEqual(
        checks.directCalculationScratchlessScalarWheelWrites,
        checks.wheelIterations * 4,
        benchmark,
        'directCalculationScratchlessScalarWheelWrites',
      );
      requireTrue(checks.directCalculationSingleSampleWheels, benchmark, 'directCalculationSingleSampleWheels');
      requireTrue(checks.directCalculationFreshWheelArrays, benchmark, 'directCalculationFreshWheelArrays');
      requireEqual(checks.nearestQueries, 0, benchmark, 'nearestQueries');
      requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
      requireEqual(checks.segmentNeighborhoodQueries, 0, benchmark, 'segmentNeighborhoodQueries');
      requireEqual(checks.segmentNeighborhoodBatchCalls, 0, benchmark, 'segmentNeighborhoodBatchCalls');
      requireEqual(checks.pitQueries, 0, benchmark, 'pitQueries');
      requireEqual(checks.pitBoxGridMisses, 0, benchmark, 'pitBoxGridMisses');
      requireEqual(checks.connectorQueriedStatePoolLength, 0, benchmark, 'connectorQueriedStatePoolLength');
      requireTrue(checks.connectorQueriedStateObjectsReused, benchmark, 'connectorQueriedStateObjectsReused');
      requireTrue(checks.connectorProjectionObjectsReused, benchmark, 'connectorProjectionObjectsReused');
    } else {
      requirePositive(checks.nearestQueries, benchmark, 'nearestQueries');
      requireEqual(checks.connectorAnalyticSamples, checks.wheelIterations, benchmark, 'connectorAnalyticSamples');
      requireAtMost(checks.nearestQueries, checks.wheelIterations * 2, benchmark, 'nearestQueries');
      requireEqual(checks.hintedArcQueries, 0, benchmark, 'hintedArcQueries');
      requirePositive(checks.segmentNeighborhoodQueries, benchmark, 'segmentNeighborhoodQueries');
      requirePositive(checks.segmentNeighborhoodBatchCalls, benchmark, 'segmentNeighborhoodBatchCalls');
      requireAtMost(checks.segmentNeighborhoodQueries, checks.segmentNeighborhoodBatchCalls * 4, benchmark, 'segmentNeighborhoodQueries');
      requireAtMost(checks.pitQueries, checks.wheelIterations, benchmark, 'pitQueries');
      requireEqual(checks.pitBoxGridMisses, 0, benchmark, 'pitBoxGridMisses');
      requireTrue(checks.connectorQueriedStateObjectsReused, benchmark, 'connectorQueriedStateObjectsReused');
      requireTrue(checks.connectorProjectionObjectsReused, benchmark, 'connectorProjectionObjectsReused');
    }
  } else if (benchmark.category === 'environment') {
    requirePositive(checks.steps, benchmark, 'steps');
    requirePositive(checks.controlledDrivers, benchmark, 'controlledDrivers');
    requireEqual(checks.vectorObservations, checks.controlledDrivers, benchmark, 'vectorObservations');
    requirePositive(checks.minVectorLength, benchmark, 'minVectorLength');
    requireTrue(checks.stateIsNull, benchmark, 'stateIsNull');
    requireTrue(checks.observationCarsByIdMapReused, benchmark, 'observationCarsByIdMapReused');
    requireTrue(checks.observationEventsByDriverSkippedWithoutEvents, benchmark, 'observationEventsByDriverSkippedWithoutEvents');
    requireTrue(checks.metricsPreviousCarsByIdMapReused, benchmark, 'metricsPreviousCarsByIdMapReused');
    requireTrue(checks.metricsCurrentCarsByIdMapReused, benchmark, 'metricsCurrentCarsByIdMapReused');
    requireTrue(checks.metricsContactCountsSkippedWithoutEvents, benchmark, 'metricsContactCountsSkippedWithoutEvents');
  } else if (benchmark.category === 'snapshots') {
    requirePositive(checks.fullSnapshots, benchmark, 'fullSnapshots');
    requirePositive(checks.renderSnapshots, benchmark, 'renderSnapshots');
    requirePositive(checks.observationSnapshots, benchmark, 'observationSnapshots');
    requirePositive(checks.trainingSnapshots, benchmark, 'trainingSnapshots');
    requireEqual(checks.renderCarHasSetup, false, benchmark, 'renderCarHasSetup');
  } else if (benchmark.category === 'snapshot-json') {
    requirePositive(checks.fullBytes, benchmark, 'fullBytes');
    requirePositive(checks.fullBytesPerSnapshot, benchmark, 'fullBytesPerSnapshot');
    requirePositive(checks.fullTrackBytesPerSnapshot, benchmark, 'fullTrackBytesPerSnapshot');
    requirePositive(checks.renderBytes, benchmark, 'renderBytes');
    requirePositive(checks.renderBytesPerSnapshot, benchmark, 'renderBytesPerSnapshot');
    requireAtMost(checks.fullBytesPerSnapshot, 105000, benchmark, 'fullBytesPerSnapshot');
    requireAtMost(checks.fullTrackBytesPerSnapshot, 50000, benchmark, 'fullTrackBytesPerSnapshot');
    requireTrue(checks.fullTrackUsesSampleSchema, benchmark, 'fullTrackUsesSampleSchema');
    requireEqual(checks.fullTrackSampleSchemaLength, 7, benchmark, 'fullTrackSampleSchemaLength');
    requireTrue(checks.fullTrackSamplesUseArrays, benchmark, 'fullTrackSamplesUseArrays');
    requireTrue(checks.fullTrackPitBoxesDropTeamMetadata, benchmark, 'fullTrackPitBoxesDropTeamMetadata');
    requireTrue(checks.renderIsLeaner, benchmark, 'renderIsLeaner');
    requireAtMost(checks.renderBytesPerSnapshot, 55000, benchmark, 'renderBytesPerSnapshot');
  } else if (benchmark.category === 'policy-server-json') {
    requirePositive(checks.richBytes, benchmark, 'richBytes');
    requirePositive(checks.compactBytes, benchmark, 'compactBytes');
    requireAtLeast(checks.byteReductionRatio, 0.6, benchmark, 'byteReductionRatio');
    requirePositive(checks.richStringifyMs, benchmark, 'richStringifyMs');
    requireAtLeast(checks.stringifyReductionRatio, 0.5, benchmark, 'stringifyReductionRatio');
    requireTrue(checks.compactHasVectors, benchmark, 'compactHasVectors');
    requireTrue(checks.compactVectorsAligned, benchmark, 'compactVectorsAligned');
    requireTrue(checks.compactPreviousActionsAligned, benchmark, 'compactPreviousActionsAligned');
    requireTrue(checks.compactMetricsAligned, benchmark, 'compactMetricsAligned');
    requireEqual(checks.compactRepeatsSpecs, false, benchmark, 'compactRepeatsSpecs');
    requireTrue(checks.resetHasSpecs, benchmark, 'resetHasSpecs');
    requireTrue(checks.resetHasCompactFields, benchmark, 'resetHasCompactFields');
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

function requireAtMost(value, maximum, benchmark, label) {
  if (!Number.isFinite(value) || value > maximum) {
    throw new Error(`Runtime benchmark "${benchmark.name}" expected ${label}<=${maximum}, received ${value}.`);
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
  return createPaddockEnvironment(createRuntimeBenchmarkEnvironmentOptions(options));
}

function createRuntimeBenchmarkEnvironmentOptions(options = {}) {
  const driverCount = options.driverCount ?? 20;
  const drivers = BENCHMARK_DRIVERS.slice(0, driverCount);
  const ids = drivers.map((driver) => driver.id);
  return {
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
  };
}
