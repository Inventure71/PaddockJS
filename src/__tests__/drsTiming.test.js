import { describe, expect, test } from 'vitest';
import { updateDrsLatch } from '../simulation/timing/drsTiming.js';

function createTrack(overrides = {}) {
  return {
    length: 1000,
    drsZones: [
      { id: 'zone-1', start: 400, end: 520 },
    ],
    ...overrides,
  };
}

function createCar(overrides = {}) {
  return {
    finished: false,
    progress: 120,
    previousProgress: 100,
    drsEligible: false,
    drsActive: false,
    drsZoneId: null,
    drsZoneEnabled: false,
    _drsZoneRef: null,
    _drsNextZoneIndex: 0,
    drsDetection: {},
    ...overrides,
  };
}

describe('drsTiming', () => {
  test('records the cached unlatched no-crossing fast path for small forward motion', () => {
    const car = createCar();
    const runtimeBenchmarkStats = {};

    updateDrsLatch(car, null, {
      time: 12,
      track: createTrack(),
      rules: { drsDetectionSeconds: 1 },
      runtimeBenchmarkStats,
    });

    expect(car.drsZoneId).toBe(null);
    expect(car.drsEligible).toBe(false);
    expect(car.drsActive).toBe(false);
    expect(car._drsNextZoneIndex).toBe(0);
    expect(runtimeBenchmarkStats.drsNextZoneCacheHits).toBe(1);
    expect(runtimeBenchmarkStats.drsNextZoneFastPathChecks).toBe(1);
  });

  test('still latches the cached next zone when progress wraps across the start line', () => {
    const track = createTrack({
      drsZones: [{ id: 'zone-1', start: 10, end: 120 }],
    });
    const car = createCar({
      progress: 20,
      previousProgress: 990,
    });
    const runtimeBenchmarkStats = {};

    updateDrsLatch(car, null, {
      time: 12,
      track,
      rules: { drsDetectionSeconds: 1 },
      runtimeBenchmarkStats,
    });

    expect(car.drsZoneId).toBe('zone-1');
    expect(car._drsZoneRef).toBe(track.drsZones[0]);
    expect(car.drsZoneEnabled).toBe(false);
    expect(car.drsActive).toBe(false);
    expect(runtimeBenchmarkStats.drsNextZoneCacheHits).toBe(1);
    expect(runtimeBenchmarkStats.drsNextZoneFastPathChecks ?? 0).toBe(0);
  });

  test('refreshes the cached next zone geometrically after crossing an unsorted custom zone', () => {
    const track = createTrack({
      drsZones: [
        { id: 'later-zone', start: 700, end: 760 },
        { id: 'first-crossed-zone', start: 100, end: 150 },
        { id: 'nearest-following-zone', start: 400, end: 460 },
      ],
    });
    const car = createCar({
      previousProgress: 50,
      progress: 120,
      _drsNextZoneIndex: 1,
    });

    updateDrsLatch(car, null, {
      time: 1,
      track,
      rules: { drsDetectionSeconds: 1 },
    });
    expect(car.drsZoneId).toBe('first-crossed-zone');
    expect(car._drsNextZoneIndex).toBe(2);

    car.previousProgress = 120;
    car.progress = 350;
    updateDrsLatch(car, null, {
      time: 2,
      track,
      rules: { drsDetectionSeconds: 1 },
    });
    expect(car.drsZoneId).toBe(null);
    expect(car._drsNextZoneIndex).toBe(2);

    car.previousProgress = 350;
    car.progress = 420;
    updateDrsLatch(car, null, {
      time: 3,
      track,
      rules: { drsDetectionSeconds: 1 },
    });
    expect(car.drsZoneId).toBe('nearest-following-zone');
    expect(car._drsNextZoneIndex).toBe(0);
  });
});
