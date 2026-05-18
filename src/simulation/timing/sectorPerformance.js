import { TELEMETRY_SECTOR_COUNT } from './timingConstants.js';

export function createEmptySectorTimes() {
  return Array.from({ length: TELEMETRY_SECTOR_COUNT }, () => null);
}

export function createEmptySectorPerformance() {
  return {
    current: createEmptySectorTimes(),
    last: createEmptySectorTimes(),
    best: createEmptySectorTimes(),
  };
}

export function serializeSectorTimes(values) {
  return createEmptySectorTimes().map((_, index) => finiteOrNull(values?.[index]));
}

export function serializeSectorPerformance(values) {
  return createEmptySectorTimes().map((_, index) => values?.[index] ?? null);
}

export function updateSectorPerformance(cars) {
  const overallBestSectors = createEmptySectorTimes();
  cars.forEach((car) => {
    car.lapTelemetry?.bestSectors?.forEach((value, index) => {
      if (!Number.isFinite(value)) return;
      const previousBest = overallBestSectors[index];
      if (!Number.isFinite(previousBest) || value < previousBest) overallBestSectors[index] = value;
    });
  });
  cars.forEach((car) => {
    const telemetry = car.lapTelemetry;
    if (!telemetry) return;
    telemetry.sectorPerformance = {
      current: telemetry.currentSectors.map((value, index) => classifySectorPerformance(
        value,
        telemetry.bestSectors[index],
        overallBestSectors[index],
      )),
      last: telemetry.lastSectors.map((value, index) => classifySectorPerformance(
        value,
        telemetry.bestSectors[index],
        overallBestSectors[index],
      )),
      best: telemetry.bestSectors.map((value, index) => classifySectorPerformance(value, value, overallBestSectors[index])),
    };
  });
}

export function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function classifySectorPerformance(value, personalBest, overallBest) {
  if (!Number.isFinite(value)) return null;
  if (Number.isFinite(overallBest) && Math.abs(value - overallBest) <= 1e-6) return 'overall-best';
  if (Number.isFinite(personalBest) && Math.abs(value - personalBest) <= 1e-6) return 'personal-best';
  return 'slower';
}
