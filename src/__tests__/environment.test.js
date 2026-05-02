import { describe, expect, test } from 'vitest';
import {
  CHAMPIONSHIP_ENTRY_BLUEPRINTS,
  DEMO_PROJECT_DRIVERS,
} from '../index.js';
import { resolveActionMap } from '../environment/actions.js';
import { createPaddockEnvironment, createProgressReward } from '../environment/index.js';
import { buildEnvironmentObservation } from '../environment/observations.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { buildRaySensors, getCarRayOrigin } from '../environment/sensors.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { nearestTrackState, offsetTrackPoint, pointAt, TRACK } from '../simulation/trackModel.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import { VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';

const ENVIRONMENT_TEST_DRIVERS = DEMO_PROJECT_DRIVERS.slice(0, 3);
const CONTROLLED_DRIVER_ID = ENVIRONMENT_TEST_DRIVERS[0].id;

function marchTrackEdgeDistance(track, car, angleDegrees, lengthMeters) {
  const heading = car.heading + (angleDegrees * Math.PI) / 180;
  const origin = getCarRayOrigin(car);
  const maxDistance = metersToSimUnits(lengthMeters);
  const step = metersToSimUnits(1);
  let previousDistance = 0;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const point = {
      x: origin.x + Math.cos(heading) * distance,
      y: origin.y + Math.sin(heading) * distance,
    };
    const state = nearestTrackState(track, point, car.progress);
    if (state.crossTrackError > track.width / 2) {
      let low = previousDistance;
      let high = distance;
      for (let index = 0; index < 12; index += 1) {
        const middle = (low + high) / 2;
        const middlePoint = {
          x: origin.x + Math.cos(heading) * middle,
          y: origin.y + Math.sin(heading) * middle,
        };
        const middleState = nearestTrackState(track, middlePoint, car.progress);
        if (middleState.crossTrackError > track.width / 2) high = middle;
        else low = middle;
      }
      return simUnitsToMeters(high);
    }
    previousDistance = distance;
  }

  return lengthMeters;
}

describe('paddock environment options', () => {
  test('requires explicit controlled drivers', () => {
    expect(() => resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
    })).toThrow('controlledDrivers is required');
  });

  test('resolves controlled-only participants', () => {
    const options = resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      scenario: { participants: 'controlled-only' },
    });

    expect(options.drivers.map((driver) => driver.id)).toEqual([CONTROLLED_DRIVER_ID]);
    expect(options.controlledDrivers).toEqual([CONTROLLED_DRIVER_ID]);
    expect(options.scenario.nonControlled).toBe('ai');
  });

  test('rejects unsupported first-slice scenario modes', () => {
    expect(() => resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      scenario: { nonControlled: 'static-obstacles' },
    })).toThrow('first slice only supports scenario.nonControlled: "ai"');
  });
});

describe('paddock environment actions', () => {
  test('maps normalized steering to simulator steering angle', () => {
    const controls = resolveActionMap({
      budget: { steering: 1, throttle: 2, brake: -1 },
    }, ['budget'], { policy: 'strict' });

    expect(controls.controlsByDriver.budget).toEqual({
      steering: VEHICLE_LIMITS.maxSteer,
      throttle: 1,
      brake: 0,
    });
    expect(controls.errors).toEqual([]);
  });

  test('throws for missing controlled-driver actions in strict mode', () => {
    expect(() => resolveActionMap({}, ['budget'], { policy: 'strict' }))
      .toThrow('Missing action for controlled driver: budget');
  });

  test('reports missing controlled-driver actions in report mode', () => {
    const result = resolveActionMap({}, ['budget'], { policy: 'report' });
    expect(result.errors).toEqual(['Missing action for controlled driver: budget']);
  });
});

describe('paddock environment observations and runtime', () => {
  test('builds object and vector observations with real units', () => {
    const options = resolveEnvironmentOptions({
      drivers: DEMO_PROJECT_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [CONTROLLED_DRIVER_ID],
      track: TRACK,
    });
    const sim = createRaceSimulation(options);
    const snapshot = sim.snapshot();
    const observation = buildEnvironmentObservation({
      snapshot,
      previousSnapshot: null,
      options,
      events: [],
    });
    const driverId = CONTROLLED_DRIVER_ID;

    expect(observation[driverId].object.self.speedKph).toEqual(expect.any(Number));
    expect(observation[driverId].object.self.trackOffsetMeters).toEqual(expect.any(Number));
    expect(observation[driverId].object.rays.length).toBeGreaterThan(0);
    expect(observation[driverId].object.nearbyCars).toEqual(expect.any(Array));
    expect(observation[driverId].vector.length).toBe(observation[driverId].schema.length);
    expect(observation[driverId].schema[0]).toHaveProperty('name');
  });

  test('ray track distances follow actual curved track geometry', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const base = pointAt(snapshot.track, 15083);
    const position = offsetTrackPoint(base, 80);
    const car = {
      ...snapshot.cars[0],
      x: position.x,
      y: position.y,
      heading: base.heading,
      progress: base.distance,
      signedOffset: 80,
    };

    const ray = buildRaySensors(car, snapshot, {
      anglesDegrees: [45],
      lengthMeters: 120,
    })[0];
    const expectedDistance = marchTrackEdgeDistance(snapshot.track, car, 45, 120);

    expect(ray.track.distanceMeters).toBeCloseTo(expectedDistance, 0);
  });

  test('ray sensors originate from the car center', () => {
    const car = {
      id: CONTROLLED_DRIVER_ID,
      x: 1000,
      y: 1200,
      heading: Math.PI / 3,
    };

    expect(getCarRayOrigin(car)).toEqual({
      x: car.x,
      y: car.y,
    });
  });

  test('default ray set stays small and includes rear awareness', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 1),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const rays = buildRaySensors(snapshot.cars[0], snapshot);
    const angles = rays.map((ray) => ray.angleDegrees);

    expect(rays).toHaveLength(8);
    expect(angles).toEqual([-135, -60, -20, 0, 20, 60, 135, 180]);
  });

  test('ray car hits require the ray to intersect the other car footprint', () => {
    const sim = createRaceSimulation({
      drivers: ENVIRONMENT_TEST_DRIVERS.slice(0, 2),
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshot();
    const car = {
      ...snapshot.cars[0],
      x: 1000,
      y: 1000,
      heading: 0,
    };
    const hitCar = {
      ...snapshot.cars[1],
      id: 'direct-hit',
      x: 1000 + metersToSimUnits(30),
      y: 1000,
      heading: 0,
      speedKph: 80,
    };
    const nearMissCar = {
      ...snapshot.cars[1],
      id: 'near-miss',
      x: 1000 + metersToSimUnits(18),
      y: 1000 + VEHICLE_LIMITS.carWidth * 2.2,
      heading: 0,
      speedKph: 80,
    };

    const hitRay = buildRaySensors(car, {
      ...snapshot,
      cars: [car, hitCar],
    }, {
      anglesDegrees: [0],
      lengthMeters: 80,
    })[0];
    const missRay = buildRaySensors(car, {
      ...snapshot,
      cars: [car, nearMissCar],
    }, {
      anglesDegrees: [0],
      lengthMeters: 80,
    })[0];

    expect(hitRay.car).toMatchObject({
      hit: true,
      driverId: 'direct-hit',
    });
    expect(hitRay.car.distanceMeters).toBeGreaterThan(10);
    expect(hitRay.car.distanceMeters).toBeLessThan(30);
    expect(missRay.car.hit).toBe(false);
  });

  test('steps a controlled car manually and returns gym-style result', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      trackSeed: 2026,
      track: TRACK,
      totalLaps: 2,
      frameSkip: 2,
    });

    const initial = env.reset();
    const result = env.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(result.info.step).toBe(1);
    expect(result.info.seed).toBe(71);
    expect(result.info.trackSeed).toBe(2026);
    expect(result.state.snapshot.time).toBeGreaterThan(initial.state.snapshot.time);
    expect(result.reward).toBeNull();
    expect(result.done).toBe(result.terminated || result.truncated);
  });

  test('runs an optional reward callback per controlled driver', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const env = createPaddockEnvironment({
      drivers: ENVIRONMENT_TEST_DRIVERS,
      entries: CHAMPIONSHIP_ENTRY_BLUEPRINTS,
      controlledDrivers: [driverId],
      seed: 71,
      trackSeed: 2026,
      track: TRACK,
      reward({ driverId: callbackDriverId }) {
        return callbackDriverId === driverId ? 7 : 0;
      },
    });

    env.reset();
    const result = env.step({
      [driverId]: { steering: 0, throttle: 1, brake: 0 },
    });

    expect(result.reward).toEqual({ [driverId]: 7 });
  });

  test('starter progress reward favors forward progress and on-track speed', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const reward = createProgressReward({
      weights: {
        progress: 1,
        speed: 0.01,
        steering: 0,
        brake: 0,
      },
    });

    const value = reward({
      driverId,
      previous: {
        cars: [{ id: driverId, distanceMeters: 100 }],
      },
      current: {
        object: {
          self: {
            speedKph: 120,
            onTrack: true,
          },
        },
      },
      action: { steering: 0.4, throttle: 1, brake: 0 },
      events: [],
      state: {
        snapshot: {
          cars: [{ id: driverId, distanceMeters: 108 }],
        },
      },
    });

    expect(value).toBeCloseTo(9.2);
  });

  test('starter progress reward penalizes off-track collisions and harsh controls', () => {
    const driverId = CONTROLLED_DRIVER_ID;
    const reward = createProgressReward({
      weights: {
        progress: 1,
        speed: 0,
        offTrack: -3,
        collision: -8,
        steering: -0.5,
        brake: -0.25,
      },
    });

    const value = reward({
      driverId,
      previous: {
        cars: [{ id: driverId, distanceMeters: 100 }],
      },
      current: {
        object: {
          self: {
            speedKph: 80,
            onTrack: false,
          },
        },
      },
      action: { steering: -0.8, throttle: 0.2, brake: 1 },
      events: [{ type: 'collision', driverId }],
      state: {
        snapshot: {
          cars: [{ id: driverId, distanceMeters: 101 }],
        },
      },
    });

    expect(value).toBeCloseTo(-10.65);
  });
});
