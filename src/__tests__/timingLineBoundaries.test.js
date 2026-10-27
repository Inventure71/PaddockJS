import { describe, expect, test } from 'vitest';
import { createRaceSimulation } from '../simulation/raceSimulation.js';
import { resetLapTelemetry } from '../simulation/timing/lapTelemetry.js';
import { getTimingLineNumber, getTimingLineCrossingTime, resetTimingLineCrossings, recordTimingLineCrossings } from '../simulation/timing/timingLines.js';

const tracedTrack = { length: 85738.88941548146, timingLines: { spacing: 2091.1924247678407, count: 41 } };

describe('timing-line representable crossing boundaries', () => {
  test('records the championship third-lap crossing when the previous pose is just below its line', () => {
    const previous = 257216.66824644327;
    const current = 257226.55304655668;
    const car = { raceDistance: previous };
    resetTimingLineCrossings(car, 434.41666666660024);
    car.raceDistance = current;
    recordTimingLineCrossings(car, previous, 434.4333333332669, tracedTrack);
    expect(getTimingLineCrossingTime(car, 123)).toBeCloseTo(434.41666666660024, 9);
    expect(car.timingLineFirstStored).toBe(123);
    expect(car.timingLineLastStored).toBe(123);
    const crossing = getTimingLineCrossingTime(car, 123);
    recordTimingLineCrossings(car, current, 434.45, tracedTrack);
    expect(getTimingLineCrossingTime(car, 123)).toBe(crossing);
  });

  test('uses half-open previous/current bounds for tiny motion and arrival exactly on a line', () => {
    const track = { length: 1000, timingLines: { spacing: 10, count: 100 } };
    const car = { raceDistance: 10 - 2e-7 };
    resetTimingLineCrossings(car, 1);
    car.raceDistance = 10;
    recordTimingLineCrossings(car, 10 - 2e-7, 2, track);
    expect(getTimingLineCrossingTime(car, 1)).toBe(2);
    car.raceDistance = 10 + 2e-7;
    recordTimingLineCrossings(car, 10, 3, track);
    expect(getTimingLineCrossingTime(car, 1)).toBe(2);
    car.raceDistance = 10 - 2e-7;
    recordTimingLineCrossings(car, 10 + 2e-7, 4, track);
    expect(getTimingLineCrossingTime(car, 1)).toBe(2);
  });

  test('division rounding cannot advance classification past a representable line product', () => {
    const line = 123;
    const boundary = line * tracedTrack.timingLines.spacing;
    const before = boundary - Number.EPSILON * boundary;
    const after = boundary + Number.EPSILON * boundary;
    expect(getTimingLineNumber(tracedTrack, before)).toBe(line - 1);
    expect(getTimingLineNumber(tracedTrack, boundary)).toBe(line);
    expect(getTimingLineNumber(tracedTrack, after)).toBe(line);
    const car = { raceDistance: before };
    resetTimingLineCrossings(car, 10);
    car.raceDistance = after;
    recordTimingLineCrossings(car, before, 11, tracedTrack);
    expect(getTimingLineCrossingTime(car, line)).toBe(10.5);
  });

  test('the actual race-state commit records each lap through repeated near-line arrivals', () => {
    const sim = createRaceSimulation({
      seed: 71, trackSeed: 7109, totalLaps: 5, warmup: false,
      drivers: [{ id: 'driver', name: 'Driver' }], rules: { standingStart: false },
    });
    const car = sim.cars[0];
    for (let lap = 1; lap <= 5; lap += 1) {
      const line = lap * sim.track.timingLines.count;
      const boundary = line * sim.track.timingLines.spacing;
      const previous = boundary - 1e-9;
      car.raceDistance = previous;
      car.previousRaceDistanceForTiming = previous;
      car.progress = previous % sim.track.length;
      resetLapTelemetry(car, lap * 100, sim.track, sim.totalLaps);
      sim.time = lap * 100;
      resetTimingLineCrossings(car, sim.time);
      car.trackState.distance = (boundary + 10) % sim.track.length;
      sim.time += 1 / 60;
      sim.recalculateRaceState({ updateDrs: false, refreshSurfaces: false });
      expect(getTimingLineCrossingTime(car, line)).not.toBe(null);
      expect(car.lapTelemetry.completedLaps).toBe(lap);
    }
  });
});
