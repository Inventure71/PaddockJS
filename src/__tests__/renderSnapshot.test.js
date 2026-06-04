import { describe, expect, test } from 'vitest';
import { createRenderSnapshot } from '../rendering/renderSnapshot.js';
import { FIXED_STEP, createRaceSimulation } from '../simulation/raceSimulation.js';

const drivers = [
  { id: 'budget', code: 'BUD', name: 'Budget Buddy', color: '#ff3860', pace: 0.94, racecraft: 0.74 },
  { id: 'noir', code: 'NOI', name: 'Neural Noir', color: '#ff9f1c', pace: 0.98, racecraft: 0.8 },
];

describe('render snapshot interpolation', () => {
  test('interpolates positions and headings without mutating the simulation snapshot', () => {
    const snapshot = {
      time: 1,
      cars: [
        {
          id: 'leader',
          previousX: 10,
          previousY: 20,
          previousHeading: Math.PI - 0.1,
          x: 30,
          y: 60,
          heading: -Math.PI + 0.1,
        },
      ],
      replayGhosts: [
        {
          id: 'best-lap',
          previousX: 50,
          previousY: 80,
          previousHeading: 0,
          x: 70,
          y: 120,
          heading: 0.6,
        },
      ],
      safetyCar: {
        previousX: 100,
        previousY: 200,
        previousHeading: 0,
        x: 120,
        y: 240,
        heading: 0.4,
      },
    };

    const interpolated = createRenderSnapshot(snapshot, 0.5);

    expect(interpolated).not.toBe(snapshot);
    expect(interpolated.cars[0]).not.toBe(snapshot.cars[0]);
    expect(interpolated.cars[0].x).toBe(20);
    expect(interpolated.cars[0].y).toBe(40);
    expect(interpolated.cars[0].heading).toBeCloseTo(Math.PI);
    expect(interpolated.safetyCar.x).toBe(110);
    expect(interpolated.safetyCar.y).toBe(220);
    expect(interpolated.safetyCar.heading).toBeCloseTo(0.2);
    expect(interpolated.replayGhosts[0].x).toBe(60);
    expect(interpolated.replayGhosts[0].y).toBe(100);
    expect(interpolated.replayGhosts[0].heading).toBeCloseTo(0.3);
    expect(snapshot.cars[0].x).toBe(30);
  });

  test('reuses internal render snapshot buffers without changing public snapshot freshness', () => {
    const sim = createRaceSimulation({
      seed: 71,
      drivers,
      rules: { standingStart: false },
    });
    const buffer = {};

    const first = sim.snapshotRenderInto(buffer);
    const firstCars = first.cars;
    const firstCar = first.cars[0];
    const publicSnapshot = sim.snapshotRender();
    sim.step(FIXED_STEP);
    const second = sim.snapshotRenderInto(buffer);

    expect(second).toBe(first);
    expect(second.cars).toBe(firstCars);
    expect(second.cars[0]).toBe(firstCar);
    expect(publicSnapshot).not.toBe(first);
    expect(publicSnapshot.cars).not.toBe(firstCars);
    expect(publicSnapshot.cars[0]).not.toBe(firstCar);
  });
});
