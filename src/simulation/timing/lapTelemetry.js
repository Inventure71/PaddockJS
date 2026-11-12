import { clamp } from '../simMath.js';
import { TELEMETRY_SECTOR_COUNT } from './timingConstants.js';
import {
  createEmptySectorPerformance,
  createEmptySectorTimes,
  finiteOrNull,
  serializeSectorPerformance,
  serializeSectorTimes,
} from './sectorPerformance.js';

function getSectorLength(track) {
  return track.length / TELEMETRY_SECTOR_COUNT;
}

function getSectorBoundaryDistance(track, boundary) {
  return Math.floor(boundary / TELEMETRY_SECTOR_COUNT) * track.length
    + (boundary % TELEMETRY_SECTOR_COUNT) * getSectorLength(track);
}

function getSectorBoundaryNumber(track, distance) {
  let boundary = Math.floor(distance / getSectorLength(track));
  // Keep timing and position on the same representable line when division rounds.
  if (boundary > 0 && getSectorBoundaryDistance(track, boundary) > distance) boundary -= 1;
  else if (getSectorBoundaryDistance(track, boundary + 1) <= distance) boundary += 1;
  return boundary;
}

function writeLapTelemetryPosition(target, track, raceDistance, totalLaps = Infinity) {
  const positiveDistance = Math.max(0, raceDistance ?? 0);
  const boundary = getSectorBoundaryNumber(track, positiveDistance);
  const completedLaps = Math.floor(boundary / TELEMETRY_SECTOR_COUNT);
  const lapIndex = Math.min(
    completedLaps,
    Math.max(0, totalLaps - 1),
  );
  const sectorLength = getSectorLength(track);
  const sectorIndex = Math.min(TELEMETRY_SECTOR_COUNT - 1, boundary - lapIndex * TELEMETRY_SECTOR_COUNT);
  const sectorStart = getSectorBoundaryDistance(track, lapIndex * TELEMETRY_SECTOR_COUNT + sectorIndex);

  target.completedLaps = Math.min(completedLaps, totalLaps);
  target.currentLap = Math.max(1, lapIndex + 1);
  target.currentSector = sectorIndex + 1;
  target.currentSectorProgress = clamp((positiveDistance - sectorStart) / sectorLength, 0, 1);
  return target;
}

function createSectorProgress(position, currentSectors = null, { preserveCompletedSectors = false } = {}) {
  const activeIndex = clamp((position.currentSector ?? 1) - 1, 0, TELEMETRY_SECTOR_COUNT - 1);
  const progress = createEmptySectorTimes();
  writeSectorProgress(progress, position, currentSectors, { preserveCompletedSectors, activeIndex });
  return progress;
}

export function createLapTelemetry(track, currentTime = 0, raceDistance = 0, totalLaps = Infinity) {
  const telemetry = {
    currentLapStartedAt: currentTime,
    currentSectorStartedAt: currentTime,
    lastUpdatedAt: currentTime,
    currentLapTime: 0,
    currentSectorElapsed: 0,
    currentSectors: createEmptySectorTimes(),
    sectorProgress: createEmptySectorTimes(),
    liveSectors: createEmptySectorTimes(),
    lastLapTime: null,
    bestLapTime: null,
    lastSectors: createEmptySectorTimes(),
    bestSectors: createEmptySectorTimes(),
    sectorPerformance: createEmptySectorPerformance(),
    sectorPerformanceRevision: 0,
  };
  writeLapTelemetryPosition(telemetry, track, raceDistance, totalLaps);
  telemetry.sectorProgress = createSectorProgress(telemetry);
  return telemetry;
}

export function resetLapTelemetry(car, currentTime, track, totalLaps) {
  car.lapTelemetry = createLapTelemetry(track, currentTime, car.raceDistance, totalLaps);
}

export function serializeLapTelemetry(telemetry) {
  return {
    currentLap: telemetry.currentLap,
    currentSector: telemetry.currentSector,
    currentLapTime: finiteOrNull(telemetry.currentLapTime),
    currentSectorElapsed: finiteOrNull(telemetry.currentSectorElapsed),
    currentSectorProgress: finiteOrNull(telemetry.currentSectorProgress),
    currentSectors: serializeSectorTimes(telemetry.currentSectors),
    sectorProgress: serializeSectorTimes(telemetry.sectorProgress),
    liveSectors: serializeSectorTimes(telemetry.liveSectors),
    lastSectors: serializeSectorTimes(telemetry.lastSectors),
    bestSectors: serializeSectorTimes(telemetry.bestSectors),
    lastLapTime: finiteOrNull(telemetry.lastLapTime),
    bestLapTime: finiteOrNull(telemetry.bestLapTime),
    sectorPerformance: {
      current: serializeSectorPerformance(telemetry.sectorPerformance?.current),
      last: serializeSectorPerformance(telemetry.sectorPerformance?.last),
      best: serializeSectorPerformance(telemetry.sectorPerformance?.best),
    },
    completedLaps: telemetry.completedLaps,
  };
}

export function updateLapTelemetry(car, previousRaceDistance, currentTime, track, totalLaps) {
  if (!car.lapTelemetry) resetLapTelemetry(car, currentTime, track, totalLaps);
  const telemetry = car.lapTelemetry;
  const currentRaceDistance = car.raceDistance ?? 0;
  const previousDistance = Math.max(0, previousRaceDistance ?? currentRaceDistance);
  const currentDistance = Math.max(0, currentRaceDistance);
  const travelled = currentDistance - previousDistance;
  const previousUpdateTime = Number.isFinite(telemetry.lastUpdatedAt) ? telemetry.lastUpdatedAt : currentTime;
  const elapsedTime = Math.max(0, currentTime - previousUpdateTime);

  if (
    !Number.isFinite(previousDistance) ||
    !Number.isFinite(currentDistance) ||
    Math.abs(travelled) > track.length / 2
  ) {
    resetLapTelemetry(car, currentTime, track, totalLaps);
    return true;
  }

  if (travelled < -1e-3) {
    syncLapTelemetryPosition(telemetry, currentTime, currentRaceDistance, track, totalLaps, {
      preserveCompletedSectors: true,
    });
    telemetry.lastUpdatedAt = currentTime;
    return false;
  }

  let crossedBoundary = false;
  if (travelled > 0) {
    const firstBoundary = getSectorBoundaryNumber(track, previousDistance) + 1;
    const lastBoundary = getSectorBoundaryNumber(track, currentDistance);

    for (let boundary = firstBoundary; boundary <= lastBoundary; boundary += 1) {
      const boundaryDistance = getSectorBoundaryDistance(track, boundary);
      if (boundaryDistance <= previousDistance || boundaryDistance > currentDistance) continue;
      crossedBoundary = true;

      const boundaryRatio = clamp((boundaryDistance - previousDistance) / travelled, 0, 1);
      const crossingTime = previousUpdateTime + boundaryRatio * elapsedTime;
      const sectorIndex = (boundary - 1) % TELEMETRY_SECTOR_COUNT;
      const sectorTime = Math.max(0, crossingTime - telemetry.currentSectorStartedAt);

      telemetry.currentSectors[sectorIndex] = sectorTime;
      updateBestSector(telemetry, sectorIndex, sectorTime);

      if (sectorIndex === TELEMETRY_SECTOR_COUNT - 1) {
        const lapTime = Math.max(0, crossingTime - telemetry.currentLapStartedAt);
        telemetry.lastLapTime = lapTime;
        telemetry.bestLapTime = Number.isFinite(telemetry.bestLapTime)
          ? Math.min(telemetry.bestLapTime, lapTime)
          : lapTime;
        telemetry.lastSectors = copySectorTimes(telemetry.lastSectors, telemetry.currentSectors);
        clearSectorTimes(telemetry.currentSectors);
        telemetry.currentLapStartedAt = crossingTime;
        telemetry.completedLaps = Math.min(
          totalLaps,
          Math.max(telemetry.completedLaps + 1, Math.floor(boundaryDistance / track.length)),
        );
      }

      telemetry.currentSectorStartedAt = crossingTime;
    }
  }

  if (!crossedBoundary) {
    syncInProgressLapTelemetry(telemetry, currentTime, currentRaceDistance, track, totalLaps);
    telemetry.lastUpdatedAt = currentTime;
    return false;
  }

  syncLapTelemetryPosition(telemetry, currentTime, currentRaceDistance, track, totalLaps);
  telemetry.lastUpdatedAt = currentTime;
  if (crossedBoundary) {
    telemetry.sectorPerformanceRevision = (telemetry.sectorPerformanceRevision ?? 0) + 1;
  }
  return crossedBoundary;
}

function updateBestSector(telemetry, sectorIndex, sectorTime) {
  const previousBest = telemetry.bestSectors[sectorIndex];
  if (!Number.isFinite(previousBest) || sectorTime < previousBest) {
    telemetry.bestSectors[sectorIndex] = sectorTime;
  }
}

function clearFutureSectorTelemetry(telemetry) {
  const activeIndex = clamp((telemetry.currentSector ?? 1) - 1, 0, TELEMETRY_SECTOR_COUNT - 1);
  for (let index = activeIndex; index < TELEMETRY_SECTOR_COUNT; index += 1) {
    telemetry.currentSectors[index] = null;
  }
}

function syncLiveSectorTelemetry(telemetry, { preserveCompletedSectors = false } = {}) {
  const activeIndex = clamp((telemetry.currentSector ?? 1) - 1, 0, TELEMETRY_SECTOR_COUNT - 1);
  const liveSectors = ensureSectorTimesArray(telemetry.liveSectors);
  clearSectorTimes(liveSectors);
  for (let index = 0; index < TELEMETRY_SECTOR_COUNT; index += 1) {
    const time = telemetry.currentSectors[index];
    if (!preserveCompletedSectors && index >= activeIndex) continue;
    if (!Number.isFinite(time)) continue;
    liveSectors[index] = time;
  }
  if (!Number.isFinite(liveSectors[activeIndex])) {
    liveSectors[activeIndex] = telemetry.currentSectorElapsed;
  }
  telemetry.liveSectors = liveSectors;
}

function syncInProgressLapTelemetry(telemetry, currentTime, currentRaceDistance, track, totalLaps) {
  writeLapTelemetryPosition(telemetry, track, currentRaceDistance, totalLaps);
  const activeIndex = telemetry.currentSector - 1;
  const sectorProgress = ensureSectorTimesArray(telemetry.sectorProgress);
  const liveSectors = ensureSectorTimesArray(telemetry.liveSectors);

  telemetry.currentLapTime = Math.max(0, currentTime - telemetry.currentLapStartedAt);
  telemetry.currentSectorElapsed = Math.max(0, currentTime - telemetry.currentSectorStartedAt);
  for (let index = activeIndex; index < TELEMETRY_SECTOR_COUNT; index += 1) {
    telemetry.currentSectors[index] = null;
    liveSectors[index] = null;
    sectorProgress[index] = 0;
  }
  sectorProgress[activeIndex] = telemetry.currentSectorProgress;
  liveSectors[activeIndex] = telemetry.currentSectorElapsed;
  telemetry.sectorProgress = sectorProgress;
  telemetry.liveSectors = liveSectors;
}

function syncLapTelemetryPosition(telemetry, currentTime, currentRaceDistance, track, totalLaps, {
  preserveCompletedSectors = false,
} = {}) {
  writeLapTelemetryPosition(telemetry, track, currentRaceDistance, totalLaps);
  if (!preserveCompletedSectors) clearFutureSectorTelemetry(telemetry);
  const sectorProgress = ensureSectorTimesArray(telemetry.sectorProgress);
  writeSectorProgress(sectorProgress, telemetry, telemetry.currentSectors, {
    preserveCompletedSectors,
  });
  telemetry.sectorProgress = sectorProgress;
  telemetry.completedLaps = Math.min(telemetry.completedLaps, totalLaps);
  telemetry.currentLapTime = Math.max(0, currentTime - telemetry.currentLapStartedAt);
  telemetry.currentSectorElapsed = Math.max(0, currentTime - telemetry.currentSectorStartedAt);
  syncLiveSectorTelemetry(telemetry, { preserveCompletedSectors });
}

function ensureSectorTimesArray(values) {
  return Array.isArray(values) && values.length === TELEMETRY_SECTOR_COUNT
    ? values
    : createEmptySectorTimes();
}

function clearSectorTimes(values) {
  for (let index = 0; index < TELEMETRY_SECTOR_COUNT; index += 1) {
    values[index] = null;
  }
}

function copySectorTimes(target, source) {
  const nextTarget = ensureSectorTimesArray(target);
  for (let index = 0; index < TELEMETRY_SECTOR_COUNT; index += 1) {
    nextTarget[index] = finiteOrNull(source?.[index]);
  }
  return nextTarget;
}

function writeSectorProgress(target, position, currentSectors = null, { preserveCompletedSectors = false, activeIndex = null } = {}) {
  const resolvedActiveIndex = activeIndex == null
    ? clamp((position.currentSector ?? 1) - 1, 0, TELEMETRY_SECTOR_COUNT - 1)
    : activeIndex;
  for (let index = 0; index < TELEMETRY_SECTOR_COUNT; index += 1) {
    if (preserveCompletedSectors && Number.isFinite(currentSectors?.[index])) {
      target[index] = 1;
      continue;
    }
    if (index < resolvedActiveIndex && Number.isFinite(currentSectors?.[index])) {
      target[index] = 1;
      continue;
    }
    target[index] = index === resolvedActiveIndex
      ? clamp(position.currentSectorProgress ?? 0, 0, 1)
      : 0;
  }
}
