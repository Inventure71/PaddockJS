import { describe, expect, test } from 'vitest';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { TRACK } from '../simulation/track/trackModel.js';
import { metersToSimUnits, kphToSimSpeed } from '../simulation/units.js';
import { buildEnvironmentObservation } from '../environment/observations.js';
import { buildNearbyCars } from '../environment/sensors/nearbyCars.js';

function createSnapshot() {
  const sim = createRaceSimulation({
    seed: 71, track: TRACK, warmup: false, rules: { standingStart: false },
    drivers: ['alpha', 'beta', 'hidden', 'far'].map((id) => ({ id, name: id })),
    participantInteractions: { drivers: { hidden: { profile: 'isolated-training' } } },
  });
  const snapshot = sim.snapshotObservation();
  for (const car of snapshot.cars) {
    Object.assign(car, { x: 0, y: 0, heading: 0, speedKph: 100, speed: kphToSimSpeed(100), velocityX: kphToSimSpeed(100), velocityY: 0 });
  }
  snapshot.cars.find((car) => car.id === 'beta').x = metersToSimUnits(10);
  snapshot.cars.find((car) => car.id === 'far').x = metersToSimUnits(200);
  snapshot.replayGhosts = [{
    id: 'alpha', x: metersToSimUnits(10), y: 0, heading: 0, speedKph: 20,
    sensors: { detectableAsNearby: true },
  }];
  return snapshot;
}

function options(output = 'full', includeSchema = true) {
  return {
    controlledDrivers: ['alpha', 'beta'],
    observation: { profile: 'physical-driver', output, includeSchema, lookaheadMeters: [] },
    sensors: { rays: { enabled: false }, nearbyCars: { enabled: true, maxCars: 3, radiusMeters: 100 } },
    sensorsByDriver: { beta: { nearbyCars: { maxCars: 1 } } },
  };
}

describe('nearby observations with shared preparation', () => {
  test.each(['full', 'object', 'vector'])('rebuilds mutable snapshot targets and preserves retained %s results', (output) => {
    const snapshot = createSnapshot();
    const config = options(output);
    const first = buildEnvironmentObservation({ snapshot, options: config });
    const retained = structuredClone(first);
    const beta = snapshot.cars.find((car) => car.id === 'beta');
    beta.x = metersToSimUnits(250);
    const hidden = snapshot.cars.find((car) => car.id === 'hidden');
    hidden.interaction = { ...hidden.interaction, detectableAsNearby: true };
    snapshot.replayGhosts[0].sensors.detectableAsNearby = false;
    const next = buildEnvironmentObservation({ snapshot, options: config });
    expect(next).not.toEqual(first);
    expect(first).toEqual(retained);
    if (output !== 'vector') {
      expect(first.alpha.object.nearbyCars.map((car) => [car.entityType, car.id])).toEqual([
        ['car', 'beta'], ['replayGhost', 'alpha'],
      ]);
      expect(next.alpha.object.nearbyCars.map((car) => car.id)).toEqual(['hidden']);
      expect(first.beta.object.nearbyCars).toHaveLength(1);
    }
  });

  test('car and replay ghost with the same ID have independent radar velocities and self exclusion', () => {
    const snapshot = createSnapshot();
    const result = buildEnvironmentObservation({ snapshot, options: options() });
    const nearby = result.beta.object.nearbyCars[0];
    expect(nearby).toMatchObject({ id: 'alpha', entityType: 'replayGhost', sameLap: false });
    expect(nearby.closingRateMetersPerSecond).toBeCloseTo(0); // Coincident centers have no projected closing rate.
    const alphaNearby = result.alpha.object.nearbyCars;
    expect(alphaNearby[0].closingRateMetersPerSecond).toBeCloseTo(0);
    expect(alphaNearby[1].closingRateMetersPerSecond).toBeCloseTo(80 / 3.6);
    expect(alphaNearby[1].timeToContactSeconds).toBeCloseTo(10 / (80 / 3.6));
  });

  test('direct vector observations match full vectors across controlled drivers', () => {
    const snapshot = createSnapshot();
    const full = buildEnvironmentObservation({ snapshot, options: options() });
    const direct = buildEnvironmentObservation({ snapshot, options: options('vector', false) });
    for (const id of ['alpha', 'beta']) expect(direct[id].vector).toEqual(full[id].vector);
  });

  test('crowded nearest shortlist keeps exact radius edges and stable car/ghost ties', () => {
    const snapshot = createSnapshot();
    const alpha = snapshot.cars.find((car) => car.id === 'alpha');
    const beta = snapshot.cars.find((car) => car.id === 'beta');
    const far = snapshot.cars.find((car) => car.id === 'far');
    far.x = metersToSimUnits(10);
    far.y = 0;
    expect(buildNearbyCars(alpha, snapshot, { maxCars: 1, radiusMeters: 10 }).map((car) => car.id)).toEqual(['beta']);
    expect(buildNearbyCars(alpha, snapshot, { maxCars: 2, radiusMeters: 10 }).map((car) => [car.entityType, car.id])).toEqual([
      ['car', 'beta'], ['car', 'far'],
    ]);
    beta.x += metersToSimUnits(0.001);
    expect(buildNearbyCars(alpha, snapshot, { maxCars: 2, radiusMeters: 10 }).map((car) => [car.entityType, car.id])).toEqual([
      ['car', 'far'], ['replayGhost', 'alpha'],
    ]);
    expect(buildNearbyCars(alpha, snapshot, { maxCars: 0, radiusMeters: 10 })).toEqual([]);
  });
});
