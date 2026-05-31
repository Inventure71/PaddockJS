import { describe, expect, test } from 'vitest';
import { FIXED_STEP, createRaceSimulation } from '../simulation/raceSimulation.js';
import { refreshLocalRaceStateForSimulation } from '../simulation/race/raceProgress.js';
import { applyRunoffResponseForSimulation } from '../simulation/vehicle/runoffResponse.js';
import { applyWheelSurfaceState } from '../simulation/vehicle/wheelSurface.js';
import { nearestTrackState, offsetTrackPoint, pointAt } from '../simulation/trackModel.js';
import { VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';
import { kphToSimSpeed, metersToSimUnits } from '../simulation/units.js';

const drivers = [
  { id: 'budget', code: 'BUD', name: 'Budget Buddy', color: '#ff3860', pace: 0.94, racecraft: 0.74 },
  { id: 'noir', code: 'NOI', name: 'Neural Noir', color: '#ff9f1c', pace: 0.98, racecraft: 0.8 },
];

function countBroadRaceStateCommits(sim) {
  const original = sim.recalculateRaceState.bind(sim);
  let calls = 0;
  sim.recalculateRaceState = (options) => {
    calls += 1;
    return original(options);
  };
  return () => calls;
}

function findMainTrackPointAwayFromPitLane(track, preferredDistance) {
  for (let scan = 0; scan < track.length; scan += 240) {
    const distance = (preferredDistance + scan) % track.length;
    const point = pointAt(track, distance);
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

    expect(broadCommits()).toBe(1);
    expect(sim.snapshot().cars).toHaveLength(drivers.length);
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

    expect(broadCommits()).toBe(1);
    expect(sim.snapshot().cars.find((car) => car.id === 'budget')).toMatchObject({
      dnf: true,
      dnfReason: 'stalled-off-track',
    });
  });

  test('runoff records reusable center state while local refresh owns post-motion wheel surfaces', () => {
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
    const movedPoint = pointAt(sim.track, point.distance + metersToSimUnits(3));
    const movedPosition = offsetTrackPoint(movedPoint, sim.track.width / 2 + sim.track.kerbWidth + metersToSimUnits(2));
    car.x = movedPosition.x;
    car.y = movedPosition.y;
    car.heading = movedPoint.heading;
    car.progress = movedPoint.distance;

    applyRunoffResponseForSimulation(sim, car);

    expect(car.destroyed).not.toBe(true);
    expect(car.wheelSurfaceCache).toBe(preRunoffCache);
    expect(car.pendingRunoffCenterState?.state).toBeTruthy();
    const pendingState = car.pendingRunoffCenterState.state;

    refreshLocalRaceStateForSimulation(sim);

    expect(car.wheelSurfaceCache).not.toBe(preRunoffCache);
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
