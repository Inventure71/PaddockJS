import { describe, expect, test } from 'vitest';
import { FIXED_STEP, createRaceSimulation } from '../simulation/raceSimulation.js';
import { refreshLocalRaceStateForSimulation } from '../simulation/race/raceProgress.js';
import { applyRunoffResponseForSimulation } from '../simulation/vehicle/runoffResponse.js';
import { applyWheelSurfaceState } from '../simulation/vehicle/wheelSurface.js';
import { nearestTrackState, offsetTrackPoint, pointAt } from '../simulation/trackModel.js';
import { expandBoundsByPadding, pointInsideBounds } from '../simulation/track/trackMath.js';
import { VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';
import { kphToSimSpeed, metersToSimUnits } from '../simulation/units.js';

const drivers = [
  { id: 'budget', code: 'BUD', name: 'Budget Buddy', color: '#ff3860', pace: 0.94, racecraft: 0.74 },
  { id: 'noir', code: 'NOI', name: 'Neural Noir', color: '#ff9f1c', pace: 0.98, racecraft: 0.8 },
];

function countBroadRaceStateCommits(sim) {
  const original = sim.recalculateRaceState.bind(sim);
  let calls = 0;
  const optionsSeen = [];
  sim.recalculateRaceState = (options) => {
    calls += 1;
    optionsSeen.push(options ?? {});
    return original(options);
  };
  return {
    calls: () => calls,
    optionsSeen: () => optionsSeen,
  };
}

function findMainTrackPointAwayFromPitLane(track, preferredDistance) {
  const pitBounds = track.pitLane?.bounds ? expandBoundsByPadding(track.pitLane.bounds, metersToSimUnits(24)) : null;
  for (let scan = 0; scan < track.length; scan += 240) {
    const distance = (preferredDistance + scan) % track.length;
    const point = pointAt(track, distance);
    if (pitBounds && pointInsideBounds(point, pitBounds)) continue;
    const probeOffsets = [
      0,
      track.width / 2 + 84,
      track.width / 2 + 120,
      track.width / 2 - VEHICLE_LIMITS.carWidth / 2 + 2,
    ];
    const overlapsPitLane = probeOffsets.some((offset) => (
      nearestTrackState(track, offsetTrackPoint(point, offset), point.distance).inPitLane
    ));
    if (!overlapsPitLane) return point;
  }

  throw new Error('Could not find a main-track point away from pit-lane geometry');
}

function placeStationaryCarOffTrack(sim, id) {
  const trackPoint = findMainTrackPointAwayFromPitLane(sim.track, 840);
  const offTrackPoint = offsetTrackPoint(
    trackPoint,
    sim.track.width / 2 + sim.track.kerbWidth + metersToSimUnits(8),
  );
  sim.setCarState(id, {
    x: offTrackPoint.x,
    y: offTrackPoint.y,
    heading: trackPoint.heading,
    speed: kphToSimSpeed(1),
    raceDistance: trackPoint.distance,
    progress: trackPoint.distance,
  });
  sim.setCarControls(id, { steering: 0, throttle: 0, brake: 1 });
}

describe('race step pipeline', () => {
  test('commits broad race state once during a normal active step', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers,
      rules: { standingStart: false },
    });
    const broadCommits = countBroadRaceStateCommits(sim);

    sim.step(FIXED_STEP);

    expect(broadCommits.calls()).toBe(1);
    expect(broadCommits.optionsSeen()).toEqual([
      expect.objectContaining({ refreshSurfaces: false }),
    ]);
    expect(sim.snapshot().cars).toHaveLength(drivers.length);
  });

  test('broad race commit derives DRS references from the current order instead of per-car field scans', () => {
    const sim = createRaceSimulation({
      seed: 76,
      drivers,
      rules: { standingStart: false },
    });
    sim.runtimeBenchmarkStats = {};
    const originalGetDrsReferenceCar = sim.getDrsReferenceCar.bind(sim);
    let drsFieldScans = 0;
    sim.getDrsReferenceCar = (car) => {
      drsFieldScans += 1;
      return originalGetDrsReferenceCar(car);
    };

    sim.step(FIXED_STEP);

    expect(drsFieldScans).toBe(0);
    expect(sim.runtimeBenchmarkStats.drsReferenceFullFieldFastPathCalls).toBe(1);
  });

  test('broad race commit does not rescan live field depth for per-car aggression updates', () => {
    const sim = createRaceSimulation({
      seed: 77,
      drivers,
      rules: { standingStart: false },
    });
    const originalComputeAggression = sim.computeAggression.bind(sim);
    let aggressionFieldScans = 0;
    sim.computeAggression = (car, orderIndex, fieldDepth) => {
      if (!Number.isFinite(fieldDepth)) aggressionFieldScans += 1;
      return originalComputeAggression(car, orderIndex, fieldDepth);
    };

    sim.step(FIXED_STEP);

    expect(aggressionFieldScans).toBe(0);
  });

  test('broad race commit reuses its ordered field for finish evaluation', () => {
    const sim = createRaceSimulation({
      seed: 78,
      drivers,
      rules: { standingStart: false },
    });
    const originalOrderedCars = sim.orderedCars.bind(sim);
    const originalEvaluateRaceFinish = sim.evaluateRaceFinish.bind(sim);
    let insideFinishEval = false;
    let finishEvalOrderedScans = 0;
    sim.orderedCars = () => {
      if (insideFinishEval) finishEvalOrderedScans += 1;
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

    sim.step(FIXED_STEP);

    expect(finishEvalOrderedScans).toBe(0);
  });

  test('exposes runtime profiler phases for surface, runoff, and broad commit work', () => {
    const sim = createRaceSimulation({
      seed: 75,
      drivers,
      physicsMode: 'advanced',
      rules: { standingStart: false },
    });
    const phases = [];
    sim.runtimeProfiler = {
      measure(name, run) {
        phases.push(name);
        return run();
      },
    };

    sim.step(FIXED_STEP);

    expect(phases).toContain('prePhysicsWheelSurface');
    expect(phases).toContain('runoffResponse');
    expect(phases).toContain('localSurfaceRefresh');
    expect(phases).toContain('broadRaceCommit');
    expect(phases.filter((phase) => phase === 'broadRaceCommit')).toHaveLength(1);
  });

  test('folds stalled-DNF classification into the same post-step commit', () => {
    const sim = createRaceSimulation({
      seed: 72,
      drivers,
      totalLaps: 1,
      rules: {
        standingStart: false,
        modules: {
          stalledDnf: {
            enabled: true,
            maxStoppedSeconds: 0.001,
            speedThresholdKph: 5,
          },
        },
      },
    });
    placeStationaryCarOffTrack(sim, 'budget');
    const broadCommits = countBroadRaceStateCommits(sim);

    sim.step(FIXED_STEP);

    expect(broadCommits.calls()).toBe(1);
    expect(sim.snapshot().cars.find((car) => car.id === 'budget')).toMatchObject({
      dnf: true,
      dnfReason: 'stalled-off-track',
    });
  });

  test('runoff preserves center-state reuse for unchanged post-motion cars', () => {
    const sim = createRaceSimulation({
      seed: 73,
      drivers,
      physicsMode: 'advanced',
      rules: { standingStart: false },
    });
    const car = sim.cars[0];
    const point = findMainTrackPointAwayFromPitLane(sim.track, 1200);
    const position = offsetTrackPoint(point, sim.track.width / 2 + sim.track.kerbWidth + metersToSimUnits(2));
    sim.setCarState(car.id, {
      x: position.x,
      y: position.y,
      heading: point.heading,
      speed: 0,
      progress: point.distance,
      raceDistance: point.distance,
    });
    const preRunoff = applyWheelSurfaceState(car, sim.track);
    const preRunoffCache = car.wheelSurfaceCache;
    const preRunoffResult = preRunoffCache.result;
    const movedPoint = pointAt(sim.track, point.distance + metersToSimUnits(3));
    const movedPosition = offsetTrackPoint(movedPoint, sim.track.width / 2 + sim.track.kerbWidth + metersToSimUnits(2));
    car.x = movedPosition.x;
    car.y = movedPosition.y;
    car.heading = movedPoint.heading;
    car.progress = movedPoint.distance;

    applyRunoffResponseForSimulation(sim, car);

    expect(car.destroyed).not.toBe(true);
    expect(car.wheelSurfaceCache).toBe(preRunoffCache);
    expect(car.wheelSurfaceCache.result).toBe(preRunoffResult);
    expect(car.pendingRunoffCenterState?.state).toBeTruthy();
    const pendingState = car.pendingRunoffCenterState.state;

    refreshLocalRaceStateForSimulation(sim);

    expect(car.wheelSurfaceCache).toBe(preRunoffCache);
    expect(car.wheelSurfaceCache.result).not.toBe(preRunoffResult);
    expect(car.trackState.distance).toBeCloseTo(pendingState.distance, 6);
    expect(car.pendingRunoffCenterState).toBeNull();
    expect(car.wheelStates).toBe(preRunoff.wheels);
  });

  test('local refresh ignores stale runoff center state after collision-style movement', () => {
    const sim = createRaceSimulation({
      seed: 74,
      drivers,
      physicsMode: 'advanced',
      rules: { standingStart: false },
    });
    const car = sim.cars[0];
    const firstPoint = findMainTrackPointAwayFromPitLane(sim.track, 1400);
    const secondPoint = findMainTrackPointAwayFromPitLane(sim.track, 2200);
    sim.setCarState(car.id, {
      x: firstPoint.x,
      y: firstPoint.y,
      heading: firstPoint.heading,
      speed: 0,
      progress: firstPoint.distance,
      raceDistance: firstPoint.distance,
    });
    applyRunoffResponseForSimulation(sim, car);
    const staleDistance = car.pendingRunoffCenterState.state.distance;
    sim.setCarState(car.id, {
      x: secondPoint.x,
      y: secondPoint.y,
      heading: secondPoint.heading,
      progress: secondPoint.distance,
      raceDistance: secondPoint.distance,
    });

    refreshLocalRaceStateForSimulation(sim);

    expect(Math.abs(car.trackState.distance - staleDistance)).toBeGreaterThan(metersToSimUnits(1));
    expect(car.trackState.distance).toBeCloseTo(secondPoint.distance, 6);
  });

});
