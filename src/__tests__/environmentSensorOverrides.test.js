import { describe, expect, test } from 'vitest';
import { createPaddockEnvironment } from '../environment/index.js';
import { TRACK } from '../simulation/track/trackModel.js';

function createEnvironment(rays = {}, sensorsByDriver = {}) {
  return createPaddockEnvironment({
    drivers: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
    entries: [], controlledDrivers: ['alpha', 'beta'], seed: 71, trackSeed: 72,
    track: TRACK, warmup: false, rules: { standingStart: false },
    sensors: { rays: { anglesDegrees: [0, 45], lengthMeters: 120, ...rays }, nearbyCars: { enabled: false } },
    sensorsByDriver,
  });
}

function assertRays(env, result, driverId, expected) {
  const spec = env.getObservationSpec();
  const perDriver = spec.perDriver[driverId] ?? spec;
  expect(result.observation[driverId].object.rays.map(({ angleDegrees, lengthMeters }) => [angleDegrees, lengthMeters])).toEqual(expected);
  expect(perDriver.object.rays.rays.map(({ angleDegrees, lengthMeters }) => [angleDegrees, lengthMeters])).toEqual(expected);
  expect(result.observation[driverId].schema).toEqual(perDriver.vector.schema);
}

describe('effective sensor options across normalization and reset', () => {
  test('per-driver global length overrides apply to defaulted rays', () => {
    const env = createEnvironment({}, { beta: { rays: { lengthMeters: 33 } } });
    assertRays(env, env.reset(), 'beta', [[0, 33], [45, 33]]);
    env.destroy();
  });

  test('reset replaces angles and inherited default length, retaining prior result ownership', () => {
    const env = createEnvironment();
    const previous = env.reset();
    const next = env.reset({ sensors: { rays: { anglesDegrees: [15, -15], lengthMeters: 55 } } });
    assertRays(env, next, 'alpha', [[15, 55], [-15, 55]]);
    expect(previous.observation.alpha.object.rays.map((ray) => ray.lengthMeters)).toEqual([120, 120]);
    env.destroy();
  });

  test('explicit per-ray lengths survive global defaults in driver overrides and repeated resets', () => {
    const env = createEnvironment({
      rays: [{ id: 'long', angleDegrees: 0, lengthMeters: 200 }, { id: 'default', angleDegrees: 90 }],
    }, { beta: { rays: { lengthMeters: 33 } } });
    assertRays(env, env.reset(), 'beta', [[0, 200], [90, 33]]);
    assertRays(env, env.reset({ sensors: { rays: { lengthMeters: 55 } } }), 'alpha', [[0, 200], [90, 55]]);
    assertRays(env, env.reset({ sensors: { rays: { defaultLengthMeters: 44 } } }), 'alpha', [[0, 200], [90, 44]]);
    env.destroy();
  });

  test('explicit angles replace an inherited preset globally and per driver', () => {
    const env = createEnvironment({ layout: 'driver-front-heavy' }, { beta: { rays: { layout: 'lidar-lite' } } });
    env.reset();
    const result = env.reset({
      sensors: { rays: { anglesDegrees: [0], lengthMeters: 25 } },
      sensorsByDriver: { beta: { rays: { anglesDegrees: [90], lengthMeters: 22 } } },
    });
    assertRays(env, result, 'alpha', [[0, 25]]);
    assertRays(env, result, 'beta', [[90, 22]]);
    const compact = env.reset({ observation: { output: 'vector', includeSchema: false }, result: { stateOutput: 'none' } });
    expect(compact.observation.alpha.vector).toEqual(result.observation.alpha.vector);
    expect(compact.observation.beta.vector).toEqual(result.observation.beta.vector);
    env.destroy();
  });
});
