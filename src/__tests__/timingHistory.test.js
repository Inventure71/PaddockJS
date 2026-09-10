import { describe, expect, test } from 'vitest';
import {
  interpolateTimeAtDistance,
  recordTimingSample,
  resetTimingHistory,
} from '../simulation/timing/timingHistory.js';
import { recordTimingLineCrossings } from '../simulation/timing/timingLines.js';

describe('timing history maintenance', () => {
  test('keeps interpolating correctly after long-history trims without shifting the array every sample', () => {
    const car = { raceDistance: 0 };
    resetTimingHistory(car, 0);

    for (let index = 1; index <= 1200; index += 1) {
      car.raceDistance = index * 10;
      recordTimingSample(car, index * 0.05);
    }

    const activeCount = car.timingHistory._count ?? 0;

    expect(activeCount).toBeGreaterThanOrEqual(2);
    expect(activeCount).toBeLessThanOrEqual(720);
    expect(interpolateTimeAtDistance(car.timingHistory, 10000)).toBeCloseTo(50, 6);
  });

  test('reuses structured interpolation neighborhoods across nearby repeated targets', () => {
    const car = { raceDistance: 0 };
    resetTimingHistory(car, 0);

    for (let index = 1; index <= 240; index += 1) {
      car.raceDistance = index * 12;
      recordTimingSample(car, index * 0.1);
    }

    expect(interpolateTimeAtDistance(car.timingHistory, 2400)).toBeCloseTo(20, 6);
    expect(interpolateTimeAtDistance(car.timingHistory, 2388)).toBeCloseTo(19.9, 6);
    expect(interpolateTimeAtDistance(car.timingHistory, 2376)).toBeCloseTo(19.8, 6);
  });

  test('can reuse the last successful structured interpolation segment directly for nearby repeated targets', () => {
    const car = { raceDistance: 0 };
    resetTimingHistory(car, 0);

    for (let index = 1; index <= 240; index += 1) {
      car.raceDistance = index * 12;
      recordTimingSample(car, index * 0.1);
    }

    car.timingHistory._interpolationStats = { directSegmentCacheHits: 0 };

    expect(interpolateTimeAtDistance(car.timingHistory, 2394)).toBeCloseTo(19.95, 6);
    expect(interpolateTimeAtDistance(car.timingHistory, 2391)).toBeCloseTo(19.925, 6);
    expect(interpolateTimeAtDistance(car.timingHistory, 2389)).toBeCloseTo(19.9083333333, 6);
    expect(car.timingHistory._interpolationStats.directSegmentCacheHits).toBeGreaterThan(0);
  });

  test('uses cached timing-line bounds so unchanged cutoffs do not rescan all stored keys', () => {
    const crossings = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
    let ownKeysCalls = 0;
    const proxiedCrossings = new Proxy(crossings, {
      ownKeys(target) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        return Object.getOwnPropertyDescriptor(target, property);
      },
    });
    const car = {
      raceDistance: 200,
      timingLineCrossings: proxiedCrossings,
      timingLineLastUpdatedAt: 12,
    };
    const track = {
      length: 1000,
      timingLines: {
        spacing: 10,
        count: 5,
      },
    };

    recordTimingLineCrossings(car, 200, 12, track);

    expect(crossings).toEqual({ 5: 5, 6: 6, 7: 7 });
    expect(car.timingLineFirstStored).toBe(5);
    expect(car.timingLineLastStored).toBe(7);
    expect(ownKeysCalls).toBe(1);

    recordTimingLineCrossings(car, 200, 12.1, track);

    expect(crossings).toEqual({ 5: 5, 6: 6, 7: 7 });
    expect(ownKeysCalls).toBe(1);
  });

});
