import { describe, expect, test } from 'vitest';
import { DEMO_PROJECT_DRIVERS } from '../data/demoDrivers.js';
import { buildDriverMetrics } from '../environment/metrics.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';

const controlledDrivers = DEMO_PROJECT_DRIVERS.slice(0, 4).map((driver) => driver.id);

function createMetricsFixture() {
  const options = resolveEnvironmentOptions({
    drivers: DEMO_PROJECT_DRIVERS,
    controlledDrivers,
    seed: 131,
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
  const previousSnapshot = sim.snapshotObservation();
  sim.step(1 / 60);
  return {
    options,
    previousSnapshot,
    snapshot: sim.snapshotObservation(),
  };
}

describe('environment metric scratch storage', () => {
  test('reuses car lookup maps and skips contact count containers without events', () => {
    const { options, previousSnapshot, snapshot } = createMetricsFixture();
    const scratch = {};

    buildDriverMetrics({ snapshot, previousSnapshot, options, events: [], scratch });
    const firstPreviousCarsById = scratch.previousCarsById;
    const firstCurrentCarsById = scratch.currentCarsById;
    buildDriverMetrics({ snapshot, previousSnapshot, options, events: [], scratch });

    expect(firstPreviousCarsById).toBeInstanceOf(Map);
    expect(firstCurrentCarsById).toBeInstanceOf(Map);
    expect(scratch.previousCarsById).toBe(firstPreviousCarsById);
    expect(scratch.currentCarsById).toBe(firstCurrentCarsById);
    expect(scratch.contactCounts).toBeUndefined();
  });

  test('reuses contact count scratch and dedupes duplicate driver ids per event', () => {
    const { options, previousSnapshot, snapshot } = createMetricsFixture();
    const scratch = {};
    const driverId = controlledDrivers[0];
    const events = [{
      type: 'collision',
      driverId,
      carId: driverId,
      otherCarId: driverId,
      driverIds: [driverId],
    }];

    const firstMetrics = buildDriverMetrics({ snapshot, previousSnapshot, options, events, scratch });
    const firstContactCounts = scratch.contactCounts;
    const firstEventDriverIds = scratch.eventDriverIds;
    const secondMetrics = buildDriverMetrics({ snapshot, previousSnapshot, options, events, scratch });

    expect(firstMetrics[driverId].contactCount).toBe(1);
    expect(secondMetrics[driverId].contactCount).toBe(1);
    expect(firstContactCounts).toBeInstanceOf(Map);
    expect(scratch.contactCounts).toBe(firstContactCounts);
    expect(Array.isArray(firstEventDriverIds)).toBe(true);
    expect(scratch.eventDriverIds).toBe(firstEventDriverIds);
    expect(scratch.eventDriverIds).toHaveLength(0);
  });
});
