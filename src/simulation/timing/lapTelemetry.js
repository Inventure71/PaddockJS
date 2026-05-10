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

function getLapTelemetryPosition(track, raceDistance, totalLaps = Infinity) {
  const positiveDistance = Math.max(0, raceDistance ?? 0);
  const lapIndex = Math.min(
    Math.floor(positiveDistance / track.length),
    Math.max(0, totalLaps - 1),
  );
  const lapProgress = positiveDistance >= track.length * totalLaps
    ? track.length
    : positiveDistance - lapIndex * track.length;
  const sectorLength = getSectorLength(track);
  const sectorIndex = Math.min(TELEMETRY_SECTOR_COUNT - 1, Math.floor(lapProgress / sectorLength));
  const sectorStart = sectorIndex * sectorLength;

  return {
    completedLaps: Math.floor(positiveDistance / track.length),
    currentLap: Math.max(1, lapIndex + 1),
    currentSector: sectorIndex + 1,
    currentSectorProgress: clamp((lapProgress - sectorStart) / sectorLength, 0, 1),
  };
}

function createSectorProgress(position, currentSectors = null) {
  const activeIndex = clamp((position.currentSector ?? 1) - 1, 0, TELEMETRY_SECTOR_COUNT - 1);
  return createEmptySectorTimes().map((_, index) => {
    if (index < activeIndex && Number.isFinite(currentSectors?.[index])) return 1;
    if (index === activeIndex) return clamp(position.currentSectorProgress ?? 0, 0, 1);
    return 0;
  });
}

export function createLapTelemetry(track, currentTime = 0, raceDistance = 0, totalLaps = Infinity) {
  const position = getLapTelemetryPosition(track, raceDistance, totalLaps);
  return {
    ...position,
    currentLapStartedAt: currentTime,
    currentSectorStartedAt: currentTime,
    lastUpdatedAt: currentTime,
    currentLapTime: 0,
    currentSectorElapsed: 0,
    currentSectors: createEmptySectorTimes(),
    sectorProgress: createSectorProgress(position),
    liveSectors: createEmptySectorTimes(),
    lastLapTime: null,
    bestLapTime: null,
    lastSectors: createEmptySectorTimes(),
    bestSectors: createEmptySectorTimes(),
    sectorPerformance: createEmptySectorPerformance(),
  };
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

  if (!Number.isFinite(previousDistance) || !Number.isFinite(currentDistance) || travelled < -1e-3 || travelled > track.length / 2) {
    resetLapTelemetry(car, currentTime, track, totalLaps);
    return;
  }

  const sectorLength = getSectorLength(track);
  if (travelled > 1e-6) {
    const firstBoundary = Math.floor(previousDistance / sectorLength) + 1;
    const lastBoundary = Math.floor(currentDistance / sectorLength);

    for (let boundary = firstBoundary; boundary <= lastBoundary; boundary += 1) {
      const boundaryDistance = boundary * sectorLength;
      if (boundaryDistance <= previousDistance + 1e-3 || boundaryDistance > currentDistance + 1e-3) continue;

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
        telemetry.lastSectors = serializeSectorTimes(telemetry.currentSectors);
        telemetry.currentSectors = createEmptySectorTimes();
        telemetry.currentLapStartedAt = crossingTime;
        telemetry.completedLaps = Math.max(telemetry.completedLaps + 1, Math.min(Math.floor(boundaryDistance / track.length), totalLaps));
      }

      telemetry.currentSectorStartedAt = crossingTime;
    }
  }

  syncLapTelemetryPosition(telemetry, currentTime, currentRaceDistance, track, totalLaps);
  telemetry.lastUpdatedAt = currentTime;
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

function syncLiveSectorTelemetry(telemetry) {
  const activeIndex = clamp((telemetry.currentSector ?? 1) - 1, 0, TELEMETRY_SECTOR_COUNT - 1);

  telemetry.liveSectors = createEmptySectorTimes();
  telemetry.currentSectors.forEach((time, index) => {
    if (index >= activeIndex) return;
    if (!Number.isFinite(time)) return;
    telemetry.liveSectors[index] = time;
  });
  telemetry.liveSectors[activeIndex] = telemetry.currentSectorElapsed;
}

function syncLapTelemetryPosition(telemetry, currentTime, currentRaceDistance, track, totalLaps) {
  const position = getLapTelemetryPosition(track, currentRaceDistance, totalLaps);
  telemetry.completedLaps = position.completedLaps;
  telemetry.currentLap = position.currentLap;
  telemetry.currentSector = position.currentSector;
  telemetry.currentSectorProgress = position.currentSectorProgress;
  clearFutureSectorTelemetry(telemetry);
  telemetry.sectorProgress = createSectorProgress(position, telemetry.currentSectors);
  telemetry.completedLaps = Math.max(telemetry.completedLaps, Math.min(position.completedLaps, totalLaps));
  telemetry.currentLapTime = Math.max(0, currentTime - telemetry.currentLapStartedAt);
  telemetry.currentSectorElapsed = Math.max(0, currentTime - telemetry.currentSectorStartedAt);
  syncLiveSectorTelemetry(telemetry);
}
