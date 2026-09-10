import { describe, expect, test } from 'vitest';
import { buildEnvironmentObservation } from '../environment/observations.js';
import { resolveEnvironmentOptions } from '../environment/options.js';
import { buildObservationSpec } from '../environment/specs.js';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { TRACK } from '../simulation/trackModel.js';

const drivers = [
  { id: 'alpha', name: 'Alpha', color: '#ff3860' },
  { id: 'beta', name: 'Beta', color: '#00ddff' },
];
const layouts = [
  { name: 'disabled', rays: { enabled: false }, maxCars: 0, channels: [] },
  { name: 'road and car', rays: { channels: ['roadEdge', 'car'] }, maxCars: 2, channels: [] },
  { name: 'surface channels', rays: { channels: ['kerb', 'illegalSurface'] }, maxCars: 1, channels: ['kerb', 'illegalSurface'] },
  { name: 'reversed surface channels', rays: { channels: ['illegalSurface', 'kerb'] }, maxCars: 1, channels: ['kerb', 'illegalSurface'] },
  { name: 'one surface channel', rays: { channels: ['illegalSurface'] }, maxCars: 2, channels: ['illegalSurface'] },
];
const cases = ['default', 'physical-driver', 'debug-map'].flatMap((profile) =>
  layouts.flatMap((layout) => ['array', 'float32'].map((vectorType) => ({ profile, layout, vectorType, name: `${profile}: ${layout.name}: ${vectorType}` }))),
);

describe('observation schema across supported sensor layouts', () => {
  test.each(cases)('$name', ({ profile, layout, vectorType }) => {
    const options = resolveEnvironmentOptions({
      drivers,
      controlledDrivers: ['alpha', 'beta'],
      seed: 71,
      track: TRACK,
      observation: { profile, vectorType, output: 'full', lookaheadMeters: profile === 'physical-driver' ? [] : [20, 50] },
      sensors: {
        rays: { anglesDegrees: [-45, 90], lengthMeters: 80, ...layout.rays },
        nearbyCars: { enabled: layout.maxCars > 0, maxCars: layout.maxCars, radiusMeters: 100 },
      },
      sensorsByDriver: {
        beta: {
          rays: { enabled: true, rays: [{ angleDegrees: 30, lengthMeters: 60 }], channels: ['illegalSurface', 'kerb'] },
          nearbyCars: { enabled: true, maxCars: 1 },
        },
      },
      rules: { standingStart: false },
    });
    const snapshot = createRaceSimulation(options).snapshotObservation();
    const full = buildEnvironmentObservation({ snapshot, options });
    const direct = buildEnvironmentObservation({
      snapshot,
      options: { ...options, observation: { ...options.observation, output: 'vector', includeSchema: false } },
      scratch: {},
    });
    const spec = buildObservationSpec(options);
    const physical = profile === 'physical-driver';
    const baseCount = 24 + (physical ? 24 : 4);
    const alphaRayCount = layout.rays.enabled === false ? 0 : 2;
    const alphaExpectedCount = baseCount + alphaRayCount * (8 + layout.channels.length * 2) + layout.maxCars * (physical ? 14 : 9);
    const betaExpectedCount = baseCount + 12 + (physical ? 14 : 9);

    expect(full.alpha.vector).toHaveLength(alphaExpectedCount);
    expect(full.beta.vector).toHaveLength(betaExpectedCount);
    for (const driverId of ['alpha', 'beta']) {
      expect(full[driverId].schema).toEqual(spec.perDriver[driverId].vector.schema);
      expect(full[driverId].schema).toHaveLength(full[driverId].vector.length);
      expect(direct[driverId].vector).toEqual(full[driverId].vector);
      expect(direct[driverId]).not.toHaveProperty('schema');
      expect(direct[driverId]).not.toHaveProperty('object');
    }
    expect(full.alpha.schema.filter(({ name }) => /^rays\[0\]\.(kerb|illegalSurface)\./.test(name)).map(({ name }) => name))
      .toEqual(layout.channels.flatMap((channel) => [`rays[0].${channel}.distanceRatio`, `rays[0].${channel}.hit`]));

    full.alpha.schema[0].name = 'changed-by-consumer';
    expect(buildObservationSpec(options).vector.schema[0].name).toBe('self.speedKph');
    expect(buildEnvironmentObservation({ snapshot, options }).alpha.schema[0].name).toBe('self.speedKph');
  });
});
