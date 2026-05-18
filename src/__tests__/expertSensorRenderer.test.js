import { describe, expect, test } from 'vitest';
import { renderExpertSensorRays } from '../app/rendering/expertSensorRenderer.js';

function createSensorLayer() {
  const calls = [];
  const layer = {
    calls,
    clear() {
      calls.push(['clear']);
      return layer;
    },
    moveTo(x, y) {
      calls.push(['moveTo', x, y]);
      return layer;
    },
    lineTo(x, y) {
      calls.push(['lineTo', x, y]);
      return layer;
    },
    stroke(options) {
      calls.push(['stroke', options]);
      return layer;
    },
    circle(x, y, radius) {
      calls.push(['circle', x, y, radius]);
      return layer;
    },
    fill(options) {
      calls.push(['fill', options]);
      return layer;
    },
  };
  return layer;
}

function ray() {
  return {
    angleDegrees: 0,
    lengthMeters: 10,
    track: { hit: true, distanceMeters: 5, kind: 'exit' },
    kerb: { hit: false, distanceMeters: 10, surface: null },
    illegalSurface: { hit: false, distanceMeters: 10, surface: null },
    barrier: { hit: false, distanceMeters: 10, surface: null },
    car: { hit: false, distanceMeters: 10 },
  };
}

describe('expert sensor renderer', () => {
  test('renders only the selected controlled driver by default', () => {
    const sensorLayer = createSensorLayer();
    renderExpertSensorRays({
      snapshot: {
        cars: [
          { id: 'alpha', x: 100, y: 0, heading: 0 },
          { id: 'beta', x: 200, y: 0, heading: 0 },
        ],
      },
      observation: {
        alpha: { object: { rays: [ray()] } },
        beta: { object: { rays: [ray()] } },
      },
      sensorLayer,
      expertMode: true,
      expertOptions: {
        controlledDrivers: ['alpha', 'beta'],
        visualizeSensors: { rays: true, selectedDriverId: 'beta' },
      },
    });

    expect(sensorLayer.calls).toContainEqual(['moveTo', 200, 0]);
    expect(sensorLayer.calls).not.toContainEqual(['moveTo', 100, 0]);
  });

  test('can opt into rendering all controlled drivers', () => {
    const sensorLayer = createSensorLayer();
    renderExpertSensorRays({
      snapshot: {
        cars: [
          { id: 'alpha', x: 100, y: 0, heading: 0 },
          { id: 'beta', x: 200, y: 0, heading: 0 },
        ],
      },
      observation: {
        alpha: { object: { rays: [ray()] } },
        beta: { object: { rays: [ray()] } },
      },
      sensorLayer,
      expertMode: true,
      expertOptions: {
        controlledDrivers: ['alpha', 'beta'],
        visualizeSensors: { rays: true, drivers: 'all', selectedDriverId: 'beta' },
      },
    });

    expect(sensorLayer.calls).toContainEqual(['moveTo', 100, 0]);
    expect(sensorLayer.calls).toContainEqual(['moveTo', 200, 0]);
  });

  test('renders active contract markers and ignores stale barrier hits', () => {
    const sensorLayer = createSensorLayer();
    renderExpertSensorRays({
      snapshot: {
        cars: [
          { id: 'alpha', x: 100, y: 0, heading: 0 },
        ],
      },
      observation: {
        alpha: {
          object: {
            rays: [{
              angleDegrees: 0,
              lengthMeters: 20,
              track: { hit: true, distanceMeters: 4, kind: 'exit' },
              kerb: { hit: true, distanceMeters: 5, surface: 'kerb' },
              illegalSurface: { hit: true, distanceMeters: 7, surface: 'gravel' },
              barrier: { hit: true, distanceMeters: 12, surface: 'barrier' },
              car: { hit: true, distanceMeters: 8, driverId: 'beta' },
            }],
          },
        },
      },
      sensorLayer,
      expertMode: true,
      expertOptions: {
        controlledDrivers: ['alpha'],
        visualizeSensors: { rays: true, selectedDriverId: 'alpha' },
      },
    });

    const fillColors = sensorLayer.calls
      .filter(([name]) => name === 'fill')
      .map(([, options]) => options.color);
    expect(fillColors).toEqual([
      0xf1c65b,
      0x49d17d,
      0xd946ef,
      0xff4d5f,
    ]);
    expect(sensorLayer.calls.filter(([name]) => name === 'circle')).toHaveLength(4);
  });
});
