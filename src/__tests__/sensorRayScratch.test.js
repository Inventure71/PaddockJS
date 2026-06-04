import { describe, expect, test } from 'vitest';
import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
} from '../index.js';
import { createPaddockEnvironment } from '../environment/index.js';
import {
  appendRaySensorVectorValues,
  createRayBatchContext,
  buildRaySensorVectorValues,
  buildRaySensors,
} from '../environment/sensors.js';
import { estimateCarHit } from '../environment/sensors/carRays.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { offsetTrackPoint, pointAt } from '../simulation/trackModel.js';
import { resetTrackQueryStats, snapshotTrackQueryStats } from '../simulation/track/trackQueryIndex.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';

const drivers = [
  { id: 'alpha', name: 'Alpha Project', color: '#ff2d55' },
  { id: 'bravo', name: 'Bravo Project', color: '#39a7ff' },
];

const rayOptions = {
  rays: [
    { id: 'front-left', angleDegrees: -35, lengthMeters: 180 },
    { id: 'front', angleDegrees: 0, lengthMeters: 220 },
    { id: 'front-right', angleDegrees: 35, lengthMeters: 180 },
  ],
  channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
  precision: 'driver',
};

function createSnapshot() {
  const sim = createRaceSimulation({
    drivers,
    seed: 1971,
    physicsMode: 'arcade',
    rules: { standingStart: false },
  });
  sim.step(1 / 60);
  return sim.snapshot();
}

function createPitLaneCar(snapshot) {
  const pitLane = snapshot.track.pitLane;
  const position = {
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
  return {
    car: {
      ...snapshot.cars[0],
      x: position.x,
      y: position.y,
      heading: pitLane.mainLane.heading,
      progress: pitLane.entry.trackDistance,
      signedOffset: 0,
      surface: 'pit-lane',
      inPitLane: true,
    },
    pitLane,
    rayOptions: {
      rays: [{ id: 'pit-side', angleDegrees: awayFromBoxesAngle, lengthMeters: 80 }],
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
    },
  };
}

function expectedVectorValuesForRay(ray, surfaceChannels = ['kerb', 'illegalSurface']) {
  const values = [
    ratio(ray.roadEdge.distanceMeters, ray.lengthMeters),
    ray.roadEdge.hit ? 1 : 0,
    ray.roadEdge.kind === 'exit' ? 1 : 0,
    ray.roadEdge.kind === 'entry' ? 1 : 0,
    ratio(ray.car.distanceMeters, ray.lengthMeters),
    ray.car.hit ? 1 : 0,
    ray.car.relativeSpeedKph / 200,
    ray.car.targetType === 'replayGhost' ? 1 : 0,
  ];
  surfaceChannels.forEach((channel) => {
    values.push(
      ratio(ray[channel].distanceMeters, ray.lengthMeters),
      ray[channel].hit ? 1 : 0,
    );
  });
  return values;
}

function ratio(value, max) {
  const finite = Number.isFinite(value) ? value : max;
  return Math.max(0, Math.min(1, finite / Math.max(1e-9, max)));
}

describe('sensor ray scratch storage', () => {
  test('reuses ray-detectable target wrappers only when batch scratch is provided', () => {
    const snapshot = createSnapshot();
    const scratch = {};

    const first = createRayBatchContext(snapshot, { scratch });
    const firstTargets = first.rayTargets;
    const firstTarget = firstTargets[0];
    const second = createRayBatchContext(snapshot, { scratch });

    expect(second.scratch).toBe(scratch);
    expect(firstTargets).toBeInstanceOf(Array);
    expect(firstTarget).toBeTruthy();
    expect(second.rayTargets).toBe(firstTargets);
    expect(second.rayTargets[0]).toBe(firstTarget);

    const publicFirst = createRayBatchContext(snapshot);
    const publicSecond = createRayBatchContext(snapshot);
    expect(publicSecond.rayTargets).not.toBe(publicFirst.rayTargets);
    expect(publicSecond.rayTargets[0]).not.toBe(publicFirst.rayTargets[0]);
  });

  test('car hit estimation can use caller-owned ray vectors and result containers', () => {
    const ego = {
      id: 'alpha',
      x: 0,
      y: 0,
      heading: 0,
      speedKph: 120,
    };
    const target = {
      id: 'bravo',
      entityType: 'car',
      x: metersToSimUnits(22),
      y: 0,
      heading: 0,
      speedKph: 80,
    };
    const resultTarget = {};
    const stats = { callerVectorCount: 0, computedVectorCount: 0, resultTargetCount: 0 };

    const result = estimateCarHit(
      ego,
      { cars: [ego, target] },
      90,
      50,
      { x: 0, y: 0 },
      [target],
      {
        rayVector: { x: 1, y: 0 },
        resultTarget,
        stats,
      },
    );

    expect(result).toBe(resultTarget);
    expect(result.hit).toBe(true);
    expect(result.targetId).toBe('bravo');
    expect(result.targetType).toBe('car');
    expect(result.relativeSpeedKph).toBe(-40);
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.distanceMeters).toBeLessThan(50);
    expect(stats).toEqual({
      callerVectorCount: 1,
      computedVectorCount: 0,
      resultTargetCount: 1,
    });
  });

  test('reuses rich ray containers only when scratch storage is provided', () => {
    const snapshot = createSnapshot();
    const car = snapshot.cars[0];
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    const first = buildRaySensors(car, snapshot, rayOptions, batchContext);
    const firstRoadEdge = first[0].roadEdge;
    const firstKerb = first[0].kerb;
    const firstIllegalSurface = first[0].illegalSurface;
    const firstCarHit = first[0].car;
    const second = buildRaySensors(car, snapshot, rayOptions, batchContext);

    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[0].roadEdge).toBe(firstRoadEdge);
    expect(second[0].kerb).toBe(firstKerb);
    expect(second[0].illegalSurface).toBe(firstIllegalSurface);
    expect(second[0].car).toBe(firstCarHit);
    expect(second[0].id).toBe('front-left');

    const publicFirst = buildRaySensors(car, snapshot, rayOptions);
    const publicSecond = buildRaySensors(car, snapshot, rayOptions);
    expect(publicSecond).not.toBe(publicFirst);
    expect(publicSecond[0]).not.toBe(publicFirst[0]);
    expect(publicSecond[0].roadEdge).not.toBe(publicFirst[0].roadEdge);
    expect(publicSecond[0].kerb).not.toBe(publicFirst[0].kerb);
    expect(publicSecond[0].illegalSurface).not.toBe(publicFirst[0].illegalSurface);
    expect(publicSecond[0].car).not.toBe(publicFirst[0].car);
  });

  test('reuses normalized ray options for scratch-backed raw option callers', () => {
    const snapshot = createSnapshot();
    const car = snapshot.cars[0];
    const rawRayOptions = {
      layout: 'driver-front-heavy',
      channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
      precision: 'driver',
      defaultLengthMeters: 200,
    };
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    buildRaySensors(car, snapshot, rawRayOptions, batchContext);
    const cache = batchContext.scratch.normalizedRayOptionsBySource;
    const firstNormalized = cache.get(rawRayOptions);
    buildRaySensorVectorValues(car, snapshot, rawRayOptions, batchContext);
    appendRaySensorVectorValues([], car, snapshot, rawRayOptions, batchContext);

    expect(firstNormalized).toBeTruthy();
    expect(cache.get(rawRayOptions)).toBe(firstNormalized);
    expect(firstNormalized).not.toBe(rawRayOptions);
    expect(firstNormalized.rays).toHaveLength(16);
  });

  test('reuses vector ray value arrays only when scratch storage is provided', () => {
    const snapshot = createSnapshot();
    const car = snapshot.cars[0];
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    const first = buildRaySensorVectorValues(car, snapshot, rayOptions, batchContext);
    const firstRayValues = first[0];
    const second = buildRaySensorVectorValues(car, snapshot, rayOptions, batchContext);

    expect(second).toBe(first);
    expect(second[0]).toBe(firstRayValues);
    expect(second[0].length).toBe(firstRayValues.length);

    const publicFirst = buildRaySensorVectorValues(car, snapshot, rayOptions);
    const publicSecond = buildRaySensorVectorValues(car, snapshot, rayOptions);
    expect(publicSecond).not.toBe(publicFirst);
    expect(publicSecond[0]).not.toBe(publicFirst[0]);
  });

  test('uses the direct indexed ray path for vector ray values when safe', () => {
    const snapshot = createSnapshot();
    const car = snapshot.cars[0];
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    const values = buildRaySensorVectorValues(car, snapshot, rayOptions, batchContext);

    expect(values).toHaveLength(rayOptions.rays.length);
    expect(batchContext.scratch.rayBandTraceStats).toEqual({
      directPathCount: rayOptions.rays.length,
      sampledPathCount: 0,
      fallbackCount: 0,
      channelSetAllocations: 0,
    });
  });

  test('batch-training surface rays use tracer-owned direct geometry and reuse boundary scratch', () => {
    const snapshot = createSnapshot();
    const car = {
      ...snapshot.cars[0],
      interaction: { profile: 'batch-training' },
    };
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };
    const surfaceRayOptions = {
      rays: [
        { id: 'surface-left', angleDegrees: -45, lengthMeters: 180 },
        { id: 'surface-right', angleDegrees: 45, lengthMeters: 180 },
      ],
      channels: ['kerb', 'illegalSurface'],
      precision: 'driver',
    };

    buildRaySensors(car, snapshot, surfaceRayOptions, batchContext);
    const firstTraceResults = batchContext.scratch.sharedRayQueries.map((query) => query.traceResult);
    const firstTraceKerbHits = firstTraceResults.map((result) => result.kerb);
    const firstTraceIllegalHits = firstTraceResults.map((result) => result.illegalSurface);
    const firstBoundaryScratch = batchContext.scratch.sharedRayQueries.map((query) => query.surfaceBoundaryScratch);
    const firstBoundaryDistances = firstBoundaryScratch.map((scratch) => scratch?.boundaryDistances);
    buildRaySensors(car, snapshot, surfaceRayOptions, batchContext);

    batchContext.scratch.sharedRayQueries.forEach((query, index) => {
      expect(query.traceResult).toBe(firstTraceResults[index]);
      expect(query.traceResult.kerb).toBe(firstTraceKerbHits[index]);
      expect(query.traceResult.illegalSurface).toBe(firstTraceIllegalHits[index]);
      expect(query.surfaceBoundaryScratch).toBe(firstBoundaryScratch[index]);
      expect(query.surfaceBoundaryScratch?.boundaryDistances).toBe(firstBoundaryDistances[index]);
    });
    expect(batchContext.scratch.rayBandTraceStats).toEqual({
      directPathCount: surfaceRayOptions.rays.length * 2,
      sampledPathCount: 0,
      fallbackCount: 0,
      channelSetAllocations: 0,
    });
  });

  test('clears stale track-band boundary caches before reusing a shared ray query slot', () => {
    const snapshot = createSnapshot();
    const car = snapshot.cars[0];
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    buildRaySensors(car, snapshot, rayOptions, batchContext);
    const firstQuery = batchContext.scratch.sharedRayQueries[0];
    firstQuery.trackBandBoundaries = {
      available: true,
      trackEdgeDistance: 123,
      kerbOuterDistance: 456,
    };

    buildRaySensors(car, snapshot, rayOptions, batchContext);

    expect(batchContext.scratch.sharedRayQueries[0]).toBe(firstQuery);
    expect(firstQuery.trackBandBoundaries).toBeNull();
  });

  test('batch-training rays keep pit connector surfaces on the tracer direct path', () => {
    const snapshot = createSnapshot();
    const pitEntry = snapshot.track.pitLane.entry.trackDistance;
    const center = pointAt(snapshot.track, pitEntry - metersToSimUnits(20));
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
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };
    const pitConnectorRayOptions = {
      rays: [
        { id: 'connector-left', angleDegrees: -90, lengthMeters: 120 },
        { id: 'connector-right', angleDegrees: 90, lengthMeters: 120 },
      ],
      channels: ['roadEdge', 'kerb', 'illegalSurface'],
      precision: 'driver',
    };

    resetTrackQueryStats(snapshot.track);
    const rays = buildRaySensors(car, snapshot, pitConnectorRayOptions, batchContext);
    const stats = snapshotTrackQueryStats(snapshot.track);

    expect(rays).toHaveLength(2);
    expect(batchContext.scratch.rayBandTraceStats).toEqual({
      directPathCount: pitConnectorRayOptions.rays.length,
      sampledPathCount: 0,
      fallbackCount: 0,
      channelSetAllocations: 0,
    });
    expect(stats.nearestQueries).toBe(0);
    expect(stats.hintedArcQueries).toBe(0);
  });

  test('same-pose main-road snapshot cars keep direct rays off generic nearest-track classification', () => {
    const snapshot = createSnapshot();
    const car = snapshot.cars[0];
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    resetTrackQueryStats(snapshot.track);
    buildRaySensors(car, snapshot, rayOptions, batchContext);
    const stats = snapshotTrackQueryStats(snapshot.track);

    expect(batchContext.scratch.rayBandTraceStats).toEqual({
      directPathCount: rayOptions.rays.length,
      sampledPathCount: 0,
      fallbackCount: 0,
      channelSetAllocations: 0,
    });
    expect(stats.nearestQueries).toBe(0);
    expect(stats.segmentNeighborhoodQueries).toBe(2);
  });

  test('keeps rich rays, vector rays, and append-vector rays aligned on the direct path', () => {
    const snapshot = createSnapshot();
    const car = snapshot.cars[0];
    const richContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };
    const vectorContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };
    const appendContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    const richRays = buildRaySensors(car, snapshot, rayOptions, richContext);
    const vectorValues = buildRaySensorVectorValues(car, snapshot, rayOptions, vectorContext);
    const appended = [];
    appendRaySensorVectorValues(appended, car, snapshot, rayOptions, appendContext);
    const expected = richRays.map((ray) => expectedVectorValuesForRay(ray));

    expect(vectorValues).toHaveLength(expected.length);
    expected.forEach((rayValues, index) => {
      expect(vectorValues[index].length).toBe(rayValues.length);
      rayValues.forEach((value, valueIndex) => {
        expect(vectorValues[index][valueIndex]).toBeCloseTo(value, 9);
      });
    });

    expect(appended).toHaveLength(expected.flat().length);
    expected.flat().forEach((value, index) => {
      expect(appended[index]).toBeCloseTo(value, 9);
    });
    expect(richContext.scratch.rayBandTraceStats).toEqual({
      directPathCount: rayOptions.rays.length,
      sampledPathCount: 0,
      fallbackCount: 0,
      channelSetAllocations: 0,
    });
    expect(vectorContext.scratch.rayBandTraceStats).toEqual({
      directPathCount: rayOptions.rays.length,
      sampledPathCount: 0,
      fallbackCount: 0,
      channelSetAllocations: 0,
    });
    expect(appendContext.scratch.rayBandTraceStats).toEqual({
      directPathCount: rayOptions.rays.length,
      sampledPathCount: 0,
      fallbackCount: 0,
      channelSetAllocations: 0,
    });
  });

  test('keeps debug precision inside the tracer-owned path', () => {
    const snapshot = createSnapshot();
    const car = snapshot.cars[0];
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    const rays = buildRaySensors(car, snapshot, {
      ...rayOptions,
      precision: 'debug',
    }, batchContext);

    expect(rays).toHaveLength(rayOptions.rays.length);
    expect(batchContext.scratch.rayBandTraceStats).toEqual({
      directPathCount: rayOptions.rays.length,
      sampledPathCount: 0,
      fallbackCount: 0,
      channelSetAllocations: 0,
    });
  });

  test('keeps pit-lane-origin side rays on direct pit-road boundary geometry', () => {
    const snapshot = createSnapshot();
    const { car, pitLane, rayOptions: pitRayOptions } = createPitLaneCar(snapshot);
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    const rays = buildRaySensors(car, snapshot, pitRayOptions, batchContext);

    expect(rays).toHaveLength(1);
    expect(rays[0].roadEdge).toMatchObject({
      hit: true,
      kind: 'exit',
    });
    expect(rays[0].roadEdge.distanceMeters).toBeGreaterThan(simUnitsToMeters(pitLane.width / 2 - 2));
    expect(rays[0].roadEdge.distanceMeters).toBeLessThan(
      simUnitsToMeters(pitLane.width / 2 + pitLane.workingLane.width),
    );
    expect(batchContext.scratch.rayBandTraceStats).toEqual({
      directPathCount: 1,
      sampledPathCount: 0,
      fallbackCount: 0,
      channelSetAllocations: 0,
    });
  });

  test('keeps normal-profile off-track ray recovery out of global nearest-query fallback', () => {
    const controlledDrivers = DEMO_PROJECT_DRIVERS.slice(0, 4).map((driver) => driver.id);
    const env = createPaddockEnvironment({
      drivers: DEMO_PROJECT_DRIVERS.slice(0, 20),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers,
      seed: 71,
      trackSeed: 4101,
      frameSkip: 2,
      scenario: { participants: 'all' },
      participantInteractions: { defaultProfile: 'normal' },
      sensors: {
        rays: {
          enabled: true,
          layout: 'driver-front-heavy',
          channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
        },
      },
      rules: {
        standingStart: false,
        modules: {
          tireDegradation: { enabled: false },
        },
      },
      episode: { maxSteps: 1000 },
    });
    const action = Object.fromEntries(controlledDrivers.map((driverId) => [
      driverId,
      { steering: 0.04, throttle: 1, brake: 0 },
    ]));

    env.reset();
    for (let step = 0; step < 70; step += 1) env.step(action);

    const stats = env.getState({ output: 'minimal' }).snapshot.track.queryIndex.stats;
    env.destroy();

    expect(stats.nearestSparseGridExactQueries).toBe(0);
    expect(stats.nearestQueries).toBeLessThanOrEqual(1500);
    expect(stats.nearestFallbacks).toBe(0);
  });
});
