import { beforeEach, describe, expect, test, vi } from 'vitest';
import { buildEnvironmentObservation } from '../environment/observations.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { appendRaySensorVectorValues, buildRaySensorVectorValues, buildRaySensors } from '../environment/sensors.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { TRACK } from '../simulation/trackModel.js';

vi.mock('../environment/sensors.js', async (importOriginal) => {
  const actual = await importOriginal();
    return {
      ...actual,
      appendRaySensorVectorValues: vi.fn(actual.appendRaySensorVectorValues),
      buildRaySensorVectorValues: vi.fn(actual.buildRaySensorVectorValues),
      buildRaySensors: vi.fn(actual.buildRaySensors),
    };
});

const drivers = [
  { id: 'budget', code: 'BUD', name: 'Budget Buddy', color: '#ff3860', pace: 0.94, racecraft: 0.74 },
  { id: 'noir', code: 'NOI', name: 'Neural Noir', color: '#ff9f1c', pace: 0.98, racecraft: 0.8 },
];

function observationOptions() {
  return resolveEnvironmentOptions({
    drivers,
    controlledDrivers: ['budget'],
    seed: 71,
    track: TRACK,
    rules: { standingStart: false },
    observation: {
      profile: 'physical-driver',
      output: 'vector',
      includeSchema: false,
    },
    sensors: {
      rays: {
        enabled: true,
        anglesDegrees: [-30, 0, 30],
        lengthMeters: 120,
        channels: ['roadEdge', 'kerb', 'illegalSurface', 'car'],
      },
      nearbyCars: { enabled: false },
    },
  });
}

describe('direct vector observations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('encode ray channels without building rich ray objects', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers,
      track: TRACK,
      rules: { standingStart: false },
    });
    const snapshot = sim.snapshotObservation();

    const observations = buildEnvironmentObservation({
      snapshot,
      options: observationOptions(),
      events: [],
    });

    expect(observations.budget.vector.length).toBeGreaterThan(0);
    expect(buildRaySensors).not.toHaveBeenCalled();
    expect(buildRaySensorVectorValues).not.toHaveBeenCalled();
    expect(appendRaySensorVectorValues).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ scratch: expect.any(Object) }),
    );
  });
});
