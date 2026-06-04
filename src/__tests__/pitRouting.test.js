import { describe, expect, test } from 'vitest';
import {
  createRoute,
  nearestDistanceOnRoute,
  sampleRoute,
  sampleRouteInto,
} from '../simulation/pit/pitRouting.js';

describe('pit route geometry', () => {
  test('deduplicates route points while preserving limiter state', () => {
    const route = createRoute([
      { x: 0, y: 0, heading: 0 },
      null,
      { x: 0, y: 0, heading: 0, limiterActive: true },
      { x: 10, y: 0, heading: 0, limiterActive: true },
      { x: 10, y: 0, heading: 0 },
      { x: 20, y: 0, heading: 0 },
    ]);

    expect(route.points).toHaveLength(3);
    expect(route.points[0].limiterActive).toBe(true);
    expect(route.segments).toHaveLength(2);
    expect(route.segments[0]).toEqual(expect.objectContaining({
      startDistance: 0,
      endDistance: 10,
      limiterActive: true,
    }));
    expect(route.length).toBe(20);
  });

  test('samples route points into caller-owned storage', () => {
    const route = createRoute([
      { x: 0, y: 0, heading: 0 },
      { x: 10, y: 0, heading: 0 },
      { x: 20, y: 10, heading: Math.PI / 4 },
    ]);
    route.runtimeBenchmarkStats = {};
    const target = { x: 0, y: 0, heading: 0, limiterActive: false };

    const first = sampleRouteInto(target, route, 5);
    const second = sampleRouteInto(target, route, 15);
    const allocated = sampleRoute(route, 15);

    expect(first).toBe(target);
    expect(second).toBe(target);
    expect(second).toEqual(expect.objectContaining({
      x: 13.535533905932738,
      y: 3.5355339059327373,
      heading: Math.PI / 4,
    }));
    expect(allocated).toEqual(second);
    expect(allocated).not.toBe(target);
    expect(route.runtimeBenchmarkStats).toEqual(expect.objectContaining({
      sampleRouteIntoCalls: 2,
      sampleRouteAllocations: 1,
    }));
  });

  test('projects nearest route distance through reusable route scratch', () => {
    const route = createRoute([
      { x: 0, y: 0, heading: 0 },
      { x: 10, y: 0, heading: 0 },
      { x: 20, y: 0, heading: 0 },
    ]);

    const first = nearestDistanceOnRoute(route, { x: 6, y: 2 }, 0);
    const scratch = route._projectionScratch;
    const second = nearestDistanceOnRoute(route, { x: 16, y: -2 }, first);

    expect(first).toBe(6);
    expect(second).toBe(16);
    expect(route._projectionScratch).toBe(scratch);
    expect(scratch).toEqual(expect.objectContaining({
      distanceAlong: 16,
      distanceSquared: 4,
    }));
  });
});
