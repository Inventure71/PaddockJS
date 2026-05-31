import { describe, expect, test } from 'vitest';
import { createRayBatchContext, buildRaySensorVectorValues, buildRaySensors } from '../environment/sensors.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';

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

describe('sensor ray scratch storage', () => {
  test('reuses rich ray containers only when scratch storage is provided', () => {
    const snapshot = createSnapshot();
    const car = snapshot.cars[0];
    const batchContext = {
      ...createRayBatchContext(snapshot),
      scratch: {},
    };

    const first = buildRaySensors(car, snapshot, rayOptions, batchContext);
    const second = buildRaySensors(car, snapshot, rayOptions, batchContext);

    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[0].id).toBe('front-left');

    const publicFirst = buildRaySensors(car, snapshot, rayOptions);
    const publicSecond = buildRaySensors(car, snapshot, rayOptions);
    expect(publicSecond).not.toBe(publicFirst);
    expect(publicSecond[0]).not.toBe(publicFirst[0]);
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
});
