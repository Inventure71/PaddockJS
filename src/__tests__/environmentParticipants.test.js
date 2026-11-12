import { describe, expect, test } from 'vitest';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { createPaddockEnvironment } from '../environment/index.js';
import { TRACK } from '../simulation/trackModel.js';

const drivers = [
  { id: 'alpha', name: 'Alpha', color: '#ff0000' },
  { id: 'bravo', name: 'Bravo', color: '#0000ff' },
];
const options = { drivers, entries: [], controlledDrivers: ['alpha', 'alpha'], seed: 71, trackSeed: 2097 };

describe('environment participant membership', () => {
  test.each([
    ['all', ['alpha', 'bravo']],
    ['controlled-only', ['alpha']],
    [['bravo', 'alpha', 'alpha'], ['alpha', 'bravo']],
  ])('preserves driver order and deduplicates controlled IDs for %j', (participants, expected) => {
    const resolved = resolveEnvironmentOptions({ ...options, scenario: { participants } });
    expect(resolved.controlledDrivers).toEqual(['alpha']);
    expect(resolved.drivers.map((driver) => driver.id)).toEqual(expected);
    expect(options.controlledDrivers).toEqual(['alpha', 'alpha']);
  });

  test('rejects unknown controlled drivers before resolving participants', () => {
    expect(() => resolveEnvironmentOptions({
      ...options, controlledDrivers: ['missing'], scenario: { participants: ['unknown'] },
    })).toThrow('PaddockJS environment controlled driver does not exist: missing');
  });

  test('rejects unknown participants before missing controlled membership', () => {
    expect(() => resolveEnvironmentOptions({ ...options, scenario: { participants: ['unknown'] } }))
      .toThrow('PaddockJS environment scenario participant does not exist: unknown');
  });

  test.each([[[]], [['bravo']]])('rejects omitted controlled participants in %j before other options', (participants) => {
    expect(() => resolveEnvironmentOptions({ ...options, scenario: { participants }, frameSkip: 0 }))
      .toThrow('PaddockJS environment controlled driver must be included in scenario participants: alpha');
  });
});

describe('environment participant resets', () => {
  function createEnvironment(participants = 'all') {
    return createPaddockEnvironment({
      ...options,
      track: TRACK,
      warmup: false,
      scenario: { participants },
      sensors: { rays: { enabled: false }, nearbyCars: { enabled: false } },
    });
  }

  test.each(['all', 'controlled-only'])('restores the full configured roster after %s participation', (participants) => {
    const env = createEnvironment(participants);
    try {
      if (participants === 'all') env.reset({ scenario: { participants: 'controlled-only' } });
      expect(env.getState().snapshot.cars.map((car) => car.id)).toEqual(['alpha']);

      const restored = env.reset({ scenario: { participants: 'all' } });
      expect(restored.state.snapshot.cars.map((car) => car.id)).toEqual(['alpha', 'bravo']);
      expect(Object.keys(restored.observation)).toEqual(['alpha']);
      expect(restored.state.snapshot).not.toHaveProperty('configuredDrivers');
      expect(env.getActionSpec()).not.toHaveProperty('configuredDrivers');
      expect(env.getObservationSpec()).not.toHaveProperty('configuredDrivers');
    } finally {
      env.destroy();
    }
  });

  test('can include an excluded driver through an explicit participant list', () => {
    const env = createEnvironment(['alpha']);
    try {
      const restored = env.reset({ scenario: { participants: ['bravo', 'alpha'] } });
      expect(restored.state.snapshot.cars.map((car) => car.id)).toEqual(['alpha', 'bravo']);
    } finally {
      env.destroy();
    }
  });

  test('can control an excluded configured driver without resupplying the roster', () => {
    const env = createEnvironment('controlled-only');
    try {
      const switched = env.reset({ controlledDrivers: ['bravo'] });
      expect(switched.state.snapshot.cars.map((car) => car.id)).toEqual(['bravo']);
      expect(Object.keys(switched.observation)).toEqual(['bravo']);
      expect(env.getActionSpec().controlledDrivers).toEqual(['bravo']);

      const restored = env.reset({ scenario: { participants: 'all' } });
      expect(restored.state.snapshot.cars.map((car) => car.id)).toEqual(['alpha', 'bravo']);
      expect(Object.keys(restored.observation)).toEqual(['bravo']);
    } finally {
      env.destroy();
    }
  });

  test('an explicit driver roster replaces retained participants', () => {
    const env = createEnvironment('controlled-only');
    try {
      const replaced = env.reset({
        drivers: [drivers[0], { id: 'charlie', name: 'Charlie', color: '#00ff00' }],
        scenario: { participants: 'all' },
      });
      expect(replaced.state.snapshot.cars.map((car) => car.id)).toEqual(['alpha', 'charlie']);

      env.reset({ scenario: { participants: 'controlled-only' } });
      const restored = env.reset({ scenario: { participants: 'all' } });
      expect(restored.state.snapshot.cars.map((car) => car.id)).toEqual(['alpha', 'charlie']);
      expect(() => env.reset({ controlledDrivers: ['bravo'] })).toThrow('controlled driver does not exist: bravo');
    } finally {
      env.destroy();
    }
  });

  test('a failed simulation reset preserves the active configuration and episode', () => {
    const env = createEnvironment();
    const action = { alpha: { steering: 0, throttle: 0, brake: 0 } };
    try {
      const before = env.step(action);
      expect(() => env.reset({
        controlledDrivers: ['bravo'],
        track: null,
        trackGeneration: { profile: 'invalid-reset-profile' },
      })).toThrow('Unsupported procedural track profile: invalid-reset-profile');

      expect(env.getActionSpec().controlledDrivers).toEqual(['alpha']);
      expect(env.getObservation()).toBe(before.observation);
      expect(env.getState()).toEqual(before.state);
      expect(env.step(action).info.step).toBe(before.info.step + 1);
      expect(env.reset().state.snapshot.cars.map((car) => car.id)).toEqual(['alpha', 'bravo']);
    } finally {
      env.destroy();
    }
  });
});
