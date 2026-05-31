import { describe, expect, test } from 'vitest';
import { FIXED_STEP, createRaceSimulation } from '../simulation/raceSimulation.js';
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
});
