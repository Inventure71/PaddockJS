import { describe, expect, test } from 'vitest';
import { estimateGapAheadSeconds, estimateTimingLineGapSeconds } from '../simulation/timing/gapEstimation.js';

function createTrackedCrossings(entries) {
  let numericGets = 0;
  const target = Object.create(null);
  Object.entries(entries).forEach(([lineNumber, time]) => {
    target[lineNumber] = time;
  });
  return {
    crossings: new Proxy(target, {
      get(innerTarget, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) numericGets += 1;
        return Reflect.get(innerTarget, property, receiver);
      },
    }),
    getNumericGets: () => numericGets,
  };
}

describe('gap estimation', () => {
  test('skips timing-line crossing lookups when either car has no stored timing-line window', () => {
    const aheadCrossings = createTrackedCrossings({ 995: 90, 996: 91 });
    const carCrossings = createTrackedCrossings({ 995: 91.2, 996: 92.2 });
    const ahead = {
      raceDistance: 10008,
      timingLineCrossings: aheadCrossings.crossings,
      timingLineFirstStored: null,
      timingLineLastStored: null,
    };
    const car = {
      raceDistance: 10005,
      timingLineCrossings: carCrossings.crossings,
      timingLineFirstStored: null,
      timingLineLastStored: null,
    };
    const track = {
      timingLines: {
        spacing: 10,
        count: 160,
      },
    };

    expect(estimateTimingLineGapSeconds(ahead, car, 100, track)).toBeNull();
    expect(aheadCrossings.getNumericGets()).toBe(0);
    expect(carCrossings.getNumericGets()).toBe(0);
  });

  test('limits timing-line scans to the overlapping stored window', () => {
    const aheadCrossings = createTrackedCrossings({ 995: 90, 996: 91, 997: 92, 998: 93, 999: 94, 1000: 95 });
    const carCrossings = createTrackedCrossings({ 995: 91.2, 996: 92.2, 997: 93.2, 998: 94.2, 999: 95.2, 1000: 96.2 });
    const ahead = {
      raceDistance: 10008,
      timingLineCrossings: aheadCrossings.crossings,
      timingLineFirstStored: 995,
      timingLineLastStored: 1000,
    };
    const car = {
      raceDistance: 10005,
      timingLineCrossings: carCrossings.crossings,
      timingLineFirstStored: 995,
      timingLineLastStored: 1000,
    };
    const track = {
      timingLines: {
        spacing: 10,
        count: 160,
      },
    };

    const gap = estimateTimingLineGapSeconds(ahead, car, 100, track);

    expect(gap).toBeCloseTo(1.2, 6);
    expect(aheadCrossings.getNumericGets()).toBeLessThanOrEqual(2);
    expect(carCrossings.getNumericGets()).toBeLessThanOrEqual(2);
  });

  test('falls straight back to timing-history interpolation when stored timing-line windows are missing', () => {
    const ahead = {
      raceDistance: 10008,
      speed: 80,
      timingLineCrossings: Object.create(null),
      timingLineFirstStored: null,
      timingLineLastStored: null,
      timingHistory: [
        { time: 99, raceDistance: 10000 },
        { time: 100, raceDistance: 10020 },
      ],
    };
    const car = {
      raceDistance: 10010,
      speed: 75,
      timingLineCrossings: Object.create(null),
      timingLineFirstStored: null,
      timingLineLastStored: null,
    };

    expect(estimateGapAheadSeconds(ahead, car, 100, { timingLines: { spacing: 10, count: 160 } })).toBeCloseTo(0.5, 6);
  });
});
