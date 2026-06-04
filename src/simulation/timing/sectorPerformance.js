import { TELEMETRY_SECTOR_COUNT } from './timingConstants.js';

const OVERALL_BEST_0 = '_sectorPerformanceOverallBest0';
const OVERALL_BEST_1 = '_sectorPerformanceOverallBest1';
const OVERALL_BEST_2 = '_sectorPerformanceOverallBest2';

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

export function updateSectorPerformance(cars, stats = null) {
  let overallBest0 = null;
  let overallBest1 = null;
  let overallBest2 = null;
  let changedCars = 0;

  for (let index = 0; index < cars.length; index += 1) {
    const telemetry = cars[index]?.lapTelemetry;
    if (!telemetry) continue;
    const best0 = finiteOrNull(telemetry.bestSectors?.[0]);
    const best1 = finiteOrNull(telemetry.bestSectors?.[1]);
    const best2 = finiteOrNull(telemetry.bestSectors?.[2]);
    const revision = telemetry.sectorPerformanceRevision ?? 0;
    if (telemetry._sectorPerfAppliedRevision !== revision) changedCars += 1;
    if (Number.isFinite(best0) && (!Number.isFinite(overallBest0) || best0 < overallBest0)) overallBest0 = best0;
    if (Number.isFinite(best1) && (!Number.isFinite(overallBest1) || best1 < overallBest1)) overallBest1 = best1;
    if (Number.isFinite(best2) && (!Number.isFinite(overallBest2) || best2 < overallBest2)) overallBest2 = best2;
  }

  const overallBestChanged =
    overallBest0 !== cars[OVERALL_BEST_0] ||
    overallBest1 !== cars[OVERALL_BEST_1] ||
    overallBest2 !== cars[OVERALL_BEST_2];

  if (stats) {
    stats.sectorPerformanceChangedCars = (stats.sectorPerformanceChangedCars ?? 0) + changedCars;
  }

  if (!overallBestChanged && changedCars === 0) {
    if (stats) stats.sectorPerformanceSkippedRebuilds = (stats.sectorPerformanceSkippedRebuilds ?? 0) + 1;
    return false;
  }

  cars[OVERALL_BEST_0] = overallBest0;
  cars[OVERALL_BEST_1] = overallBest1;
  cars[OVERALL_BEST_2] = overallBest2;

  let updatedCars = 0;
  const overallBestSectors = [overallBest0, overallBest1, overallBest2];
  for (let index = 0; index < cars.length; index += 1) {
    const telemetry = cars[index]?.lapTelemetry;
    if (!telemetry) continue;
    const revision = telemetry.sectorPerformanceRevision ?? 0;
    if (!overallBestChanged && telemetry._sectorPerfAppliedRevision === revision) continue;
    const sectorPerformance = ensureSectorPerformanceShape(telemetry.sectorPerformance);
    writeSectorPerformance(
      sectorPerformance.current,
      telemetry.currentSectors,
      telemetry.bestSectors,
      overallBestSectors,
    );
    writeSectorPerformance(
      sectorPerformance.last,
      telemetry.lastSectors,
      telemetry.bestSectors,
      overallBestSectors,
    );
    writeSectorPerformance(
      sectorPerformance.best,
      telemetry.bestSectors,
      telemetry.bestSectors,
      overallBestSectors,
    );
    telemetry.sectorPerformance = sectorPerformance;
    telemetry._sectorPerfAppliedRevision = revision;
    updatedCars += 1;
  }

  if (stats) {
    stats.sectorPerformanceRebuilds = (stats.sectorPerformanceRebuilds ?? 0) + 1;
    stats.sectorPerformanceUpdatedCars = (stats.sectorPerformanceUpdatedCars ?? 0) + updatedCars;
    if (overallBestChanged) stats.sectorPerformanceOverallBestChanges = (stats.sectorPerformanceOverallBestChanges ?? 0) + 1;
  }
  return true;
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

function ensureSectorPerformanceShape(sectorPerformance) {
  if (!sectorPerformance || typeof sectorPerformance !== 'object') {
    return createEmptySectorPerformance();
  }
  sectorPerformance.current = ensureSectorArray(sectorPerformance.current);
  sectorPerformance.last = ensureSectorArray(sectorPerformance.last);
  sectorPerformance.best = ensureSectorArray(sectorPerformance.best);
  return sectorPerformance;
}

function ensureSectorArray(values) {
  return Array.isArray(values) && values.length === TELEMETRY_SECTOR_COUNT
    ? values
    : createEmptySectorTimes();
}

function writeSectorPerformance(target, sectorValues, bestSectors, overallBestSectors) {
  for (let index = 0; index < TELEMETRY_SECTOR_COUNT; index += 1) {
    target[index] = classifySectorPerformance(
      sectorValues?.[index],
      bestSectors?.[index],
      overallBestSectors[index],
    );
  }
}
