import { describe, expect, test } from 'vitest';
import { createLapTelemetry, updateLapTelemetry } from '../simulation/timing/lapTelemetry.js';
import { updateSectorPerformance } from '../simulation/timing/sectorPerformance.js';

describe('lap telemetry', () => {
  test.each([7, 13, 14, 15])('uses the same representable line for later-lap sector %s timing and position', (boundaryNumber) => {
    const track = { length: 2500.0588235294117 };
    const boundary = Math.floor(boundaryNumber / 3) * track.length + (boundaryNumber % 3) * (track.length / 3);
    const initialDistance = boundary - 1;
    const justBefore = boundary - boundary * Number.EPSILON;
    const car = {
      raceDistance: initialDistance,
      lapTelemetry: createLapTelemetry(track, 0, initialDistance, 10),
    };

    car.raceDistance = justBefore;
    expect(updateLapTelemetry(car, initialDistance, 0.5, track, 10)).toBe(false);
    expect(car.lapTelemetry.currentSector).toBe((boundaryNumber - 1) % 3 + 1);
    expect(car.lapTelemetry.completedLaps).toBe(Math.floor((boundaryNumber - 1) / 3));

    car.raceDistance = boundary;
    expect(updateLapTelemetry(car, justBefore, 1, track, 10)).toBe(true);
    expect(car.lapTelemetry.currentSector).toBe(boundaryNumber % 3 + 1);
    expect(car.lapTelemetry.completedLaps).toBe(Math.floor(boundaryNumber / 3));
    expect(car.lapTelemetry.bestSectors[(boundaryNumber - 1) % 3]).toBe(1);
    if (boundaryNumber % 3 !== 0) {
      expect(car.lapTelemetry.currentSectors[(boundaryNumber - 1) % 3]).toBe(1);
    }
    expect(updateLapTelemetry(car, boundary, 2, track, 10)).toBe(false);
    expect(car.lapTelemetry.sectorPerformanceRevision).toBe(1);
  });

  test.each([1, 2, 3].flatMap((sector) => [0.0005, 0.0000005].flatMap((distanceBefore) =>
    [0, 10].map((distanceAfter) => ({ sector, distanceBefore, distanceAfter })),
  )))('records sector $sector once from $distanceBefore before its line to $distanceAfter after it', ({
    sector, distanceBefore, distanceAfter,
  }) => {
    const track = { length: 12000 };
    const boundary = sector * 4000;
    const previousDistance = boundary - distanceBefore;
    const car = {
      raceDistance: previousDistance,
      lapTelemetry: createLapTelemetry(track, previousDistance / 100, previousDistance, 3),
    };
    car.lapTelemetry.currentLapStartedAt = 0;
    car.lapTelemetry.currentSectorStartedAt = (sector - 1) * 40;
    for (let index = 0; index < sector - 1; index += 1) car.lapTelemetry.currentSectors[index] = 40;

    expect(updateLapTelemetry(car, previousDistance, previousDistance / 100, track, 3)).toBe(false);
    expect(car.lapTelemetry.bestSectors[sector - 1]).toBeNull();

    car.raceDistance = boundary + distanceAfter;
    expect(updateLapTelemetry(car, previousDistance, car.raceDistance / 100, track, 3)).toBe(true);
    expect(car.lapTelemetry.bestSectors[sector - 1]).toBeCloseTo(40, 8);
    expect(car.lapTelemetry.sectorPerformanceRevision).toBe(1);
    if (sector === 3) {
      expect(car.lapTelemetry.lastSectors).toEqual([40, 40, 40]);
      expect(car.lapTelemetry.lastLapTime).toBeCloseTo(120, 8);
      expect(car.lapTelemetry.bestLapTime).toBeCloseTo(120, 8);
      expect(car.lapTelemetry.completedLaps).toBe(1);
    } else {
      expect(car.lapTelemetry.currentSectors[sector - 1]).toBeCloseTo(40, 8);
      expect(car.lapTelemetry.lastLapTime).toBeNull();
    }

    const crossingDistance = car.raceDistance;
    expect(updateLapTelemetry(car, crossingDistance, crossingDistance / 100 + 1, track, 3)).toBe(false);
    car.raceDistance += 10;
    expect(updateLapTelemetry(car, crossingDistance, car.raceDistance / 100 + 1, track, 3)).toBe(false);
    expect(car.lapTelemetry.bestSectors[sector - 1]).toBeCloseTo(40, 8);
    expect(car.lapTelemetry.sectorPerformanceRevision).toBe(1);
    if (sector === 3) expect(car.lapTelemetry.lastLapTime).toBeCloseTo(120, 8);
  });

  test('retains a complete lap when the previous sample is just before the timing line', () => {
    const track = { length: 12000 };
    const car = { raceDistance: 0, lapTelemetry: createLapTelemetry(track, 0, 0, 3) };

    for (const distance of [3990, 4010, 7990, 8010, 11999.9995, 12010]) {
      const previousDistance = car.raceDistance;
      car.raceDistance = distance;
      updateLapTelemetry(car, previousDistance, distance / 100, track, 3);
    }

    expect(car.lapTelemetry.completedLaps).toBe(1);
    expect(car.lapTelemetry.lastLapTime).toBeCloseTo(120, 8);
    expect(car.lapTelemetry.bestLapTime).toBeCloseTo(120, 8);
    car.lapTelemetry.lastSectors.forEach((time) => expect(time).toBeCloseTo(40, 8));
  });

  test('reuses position buffers and updates only the active slot on same-sector progress', () => {
    const track = { length: 300 };
    const car = {
      raceDistance: 110,
      lapTelemetry: createLapTelemetry(track, 0, 110, 3),
    };
    car.lapTelemetry.currentLapStartedAt = 0;
    car.lapTelemetry.currentSectorStartedAt = 0.5;
    car.lapTelemetry.currentSectors[0] = 10;
    car.lapTelemetry.liveSectors[0] = 10;
    car.lapTelemetry.sectorProgress[0] = 1;

    const currentSectors = car.lapTelemetry.currentSectors;
    const liveSectors = car.lapTelemetry.liveSectors;
    const sectorProgress = car.lapTelemetry.sectorProgress;

    car.raceDistance = 120;
    updateLapTelemetry(car, 110, 2, track, 3);

    expect(car.lapTelemetry.currentSectors).toBe(currentSectors);
    expect(car.lapTelemetry.liveSectors).toBe(liveSectors);
    expect(car.lapTelemetry.sectorProgress).toBe(sectorProgress);
    expect(car.lapTelemetry.currentLap).toBe(1);
    expect(car.lapTelemetry.currentSector).toBe(2);
    expect(car.lapTelemetry.currentSectors[0]).toBe(10);
    expect(car.lapTelemetry.liveSectors[0]).toBe(10);
    expect(car.lapTelemetry.liveSectors[1]).toBeCloseTo(1.5, 6);
    expect(car.lapTelemetry.sectorProgress[0]).toBe(1);
    expect(car.lapTelemetry.sectorProgress[1]).toBeCloseTo(0.2, 6);
    expect(car.lapTelemetry.sectorProgress[2]).toBe(0);
  });

  test('reuses sector arrays when syncing in-progress telemetry', () => {
    const track = { length: 300 };
    const car = {
      raceDistance: 25,
      lapTelemetry: createLapTelemetry(track, 0, 25, 3),
    };
    const currentSectors = car.lapTelemetry.currentSectors;
    const liveSectors = car.lapTelemetry.liveSectors;
    const sectorProgress = car.lapTelemetry.sectorProgress;

    car.raceDistance = 135;
    updateLapTelemetry(car, 25, 2, track, 3);

    expect(car.lapTelemetry.currentSectors).toBe(currentSectors);
    expect(car.lapTelemetry.liveSectors).toBe(liveSectors);
    expect(car.lapTelemetry.sectorProgress).toBe(sectorProgress);
    expect(car.lapTelemetry.currentSector).toBe(2);
    expect(car.lapTelemetry.currentSectors[0]).toBeGreaterThan(0);
  });

  test('reuses split buffers when a lap completes', () => {
    const track = { length: 300 };
    const car = {
      raceDistance: 290,
      lapTelemetry: createLapTelemetry(track, 0, 290, 3),
    };
    car.lapTelemetry.currentLapStartedAt = 0;
    car.lapTelemetry.currentSectorStartedAt = 0;
    car.lapTelemetry.currentSectors[0] = 11;
    car.lapTelemetry.currentSectors[1] = 22;

    const currentSectors = car.lapTelemetry.currentSectors;
    const lastSectors = car.lapTelemetry.lastSectors;

    car.raceDistance = 305;
    updateLapTelemetry(car, 290, 1, track, 3);

    expect(car.lapTelemetry.currentSectors).toBe(currentSectors);
    expect(car.lapTelemetry.lastSectors).toBe(lastSectors);
    expect(car.lapTelemetry.lastSectors[0]).toBe(11);
    expect(car.lapTelemetry.lastSectors[1]).toBe(22);
    expect(car.lapTelemetry.lastSectors[2]).toBeGreaterThan(0);
    expect(car.lapTelemetry.currentSectors).toEqual([null, null, null]);
    expect(car.lapTelemetry.currentLap).toBe(2);
  });

  test('reuses sector performance buffers', () => {
    const track = { length: 300 };
    const first = {
      lapTelemetry: createLapTelemetry(track, 0, 110, 3),
    };
    const second = {
      lapTelemetry: createLapTelemetry(track, 0, 120, 3),
    };
    first.lapTelemetry.currentSectors[0] = 31;
    first.lapTelemetry.lastSectors[0] = 31;
    first.lapTelemetry.bestSectors[0] = 29;
    second.lapTelemetry.currentSectors[0] = 28;
    second.lapTelemetry.lastSectors[0] = 30;
    second.lapTelemetry.bestSectors[0] = 28;

    const sectorPerformance = first.lapTelemetry.sectorPerformance;
    const current = sectorPerformance.current;
    const last = sectorPerformance.last;
    const best = sectorPerformance.best;

    updateSectorPerformance([first, second]);

    expect(first.lapTelemetry.sectorPerformance).toBe(sectorPerformance);
    expect(first.lapTelemetry.sectorPerformance.current).toBe(current);
    expect(first.lapTelemetry.sectorPerformance.last).toBe(last);
    expect(first.lapTelemetry.sectorPerformance.best).toBe(best);
    expect(first.lapTelemetry.sectorPerformance.current[0]).toBe('slower');
    expect(first.lapTelemetry.sectorPerformance.best[0]).toBe('personal-best');
    expect(second.lapTelemetry.sectorPerformance.current[0]).toBe('overall-best');
  });

  test('skips sector performance rewrites when sector source data is unchanged', () => {
    const track = { length: 300 };
    const first = {
      lapTelemetry: createLapTelemetry(track, 0, 110, 3),
    };
    const second = {
      lapTelemetry: createLapTelemetry(track, 0, 120, 3),
    };
    first.lapTelemetry.currentSectors[0] = 31;
    first.lapTelemetry.lastSectors[0] = 31;
    first.lapTelemetry.bestSectors[0] = 29;
    second.lapTelemetry.currentSectors[0] = 28;
    second.lapTelemetry.lastSectors[0] = 30;
    second.lapTelemetry.bestSectors[0] = 28;
    const cars = [first, second];

    expect(updateSectorPerformance(cars)).toBe(true);

    const sectorPerformance = first.lapTelemetry.sectorPerformance;
    const current = sectorPerformance.current;
    const last = sectorPerformance.last;
    const best = sectorPerformance.best;

    expect(updateSectorPerformance(cars)).toBe(false);
    expect(first.lapTelemetry.sectorPerformance).toBe(sectorPerformance);
    expect(first.lapTelemetry.sectorPerformance.current).toBe(current);
    expect(first.lapTelemetry.sectorPerformance.last).toBe(last);
    expect(first.lapTelemetry.sectorPerformance.best).toBe(best);
  });
});
