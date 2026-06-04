import { describe, expect, test } from 'vitest';
import { DEMO_PROJECT_DRIVERS } from '../data/demoDrivers.js';
import { buildEnvironmentObservation } from '../environment/observations.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';

const controlledDrivers = DEMO_PROJECT_DRIVERS.slice(0, 4).map((driver) => driver.id);

function createObservationFixture() {
  const options = resolveEnvironmentOptions({
    drivers: DEMO_PROJECT_DRIVERS,
    controlledDrivers,
    seed: 117,
    physicsMode: 'arcade',
    observation: {
      output: 'vector',
      includeSchema: false,
    },
    result: {
      stateOutput: 'none',
    },
    sensors: {
      rays: { enabled: false },
      nearbyCars: { enabled: false },
    },
    rules: {
      standingStart: false,
      modules: {
        pitStops: { enabled: false },
        tireDegradation: { enabled: false },
      },
    },
  });
  const sim = createRaceSimulation(options);
  sim.step(1 / 60);
  return {
    options,
    snapshot: sim.snapshotObservation(),
  };
}

describe('environment observation scratch storage', () => {
  test('reuses the controlled-driver car lookup map on repeated observation builds', () => {
    const { options, snapshot } = createObservationFixture();
    const scratch = {};

    buildEnvironmentObservation({ snapshot, options, events: [], scratch });
    const firstCarsById = scratch.carsById;
    buildEnvironmentObservation({ snapshot, options, events: [], scratch });

    expect(firstCarsById).toBeInstanceOf(Map);
    expect(scratch.carsById).toBe(firstCarsById);
    expect(scratch.eventsByDriver).toBeUndefined();
  });
});
