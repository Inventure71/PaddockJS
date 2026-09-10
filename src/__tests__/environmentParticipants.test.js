import { describe, expect, test } from 'vitest';
import { resolveEnvironmentOptions } from '../environment/options.js';

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
