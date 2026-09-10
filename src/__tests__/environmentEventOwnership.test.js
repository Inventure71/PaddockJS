import { describe, expect, test } from 'vitest';
import { collectStepEvents } from '../environment/events.js';
import { buildDriverMetrics } from '../environment/metrics.js';
import { buildEnvironmentObservation } from '../environment/observations.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { TRACK } from '../simulation/trackModel.js';

const controlledDrivers = ['alpha', 'beta'];

function fixture() {
  const options = resolveEnvironmentOptions({
    drivers: controlledDrivers.map((id) => ({ id, name: id, color: '#ff3860' })),
    controlledDrivers,
    seed: 71,
    track: TRACK,
    sensors: { rays: { enabled: false }, nearbyCars: { enabled: false } },
    rules: { standingStart: false },
  });
  return { options, snapshot: createRaceSimulation(options).snapshotObservation() };
}

describe('environment event membership and result ownership', () => {
  test('observations and metrics deduplicate the same members without sharing retained result arrays', () => {
    const { options, snapshot } = fixture();
    const observationScratch = {};
    const metricScratch = {};
    const events = collectStepEvents([
      { type: 'contact', carId: 'alpha', otherCarId: 'beta' },
      { type: 'collision', driverId: 'alpha', carId: 'alpha', otherCarId: 'beta', driverIds: ['beta', 'alpha', '', null, 'traffic'] },
      { type: 'car-contact', driverIds: ['beta', 'beta'] },
      { type: 'pit-entry', driverId: 'alpha', driverIds: ['alpha'] },
      { type: 'collision', driverId: 'traffic' },
    ]);
    const observation = buildEnvironmentObservation({ snapshot, options, events, scratch: observationScratch });
    const metrics = buildDriverMetrics({ snapshot, options, events, scratch: metricScratch });

    expect(observation.alpha.events).toEqual([events[0], events[1], events[3]]);
    expect(observation.beta.events).toEqual([events[0], events[1], events[2]]);
    expect(metrics.alpha.contactCount).toBe(2);
    expect(metrics.beta.contactCount).toBe(3);
    expect(observation.alpha.object.events).toBe(observation.alpha.events);

    const nextEvents = collectStepEvents([{ type: 'collision', driverId: 'beta' }]);
    const nextObservation = buildEnvironmentObservation({ snapshot, options, events: nextEvents, scratch: observationScratch });
    const nextMetrics = buildDriverMetrics({ snapshot, options, events: nextEvents, scratch: metricScratch });
    expect(nextObservation.alpha.events).toEqual([]);
    expect(nextObservation.beta.events).toEqual(nextEvents);
    expect(nextMetrics.alpha.contactCount).toBe(0);
    expect(nextMetrics.beta.contactCount).toBe(1);
    expect(observation.alpha.events).toEqual([events[0], events[1], events[3]]);
    expect(observation.beta.events).toEqual([events[0], events[1], events[2]]);
    expect(metrics.alpha.contactCount).toBe(2);
    expect(observationScratch.eventDriverIds).toEqual([]);
    expect(metricScratch.eventDriverIds).toEqual([]);
    expect(metricScratch.eventDriverIds).not.toBe(observationScratch.eventDriverIds);
  });
});
