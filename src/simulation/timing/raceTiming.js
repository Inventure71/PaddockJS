import { clamp } from '../simMath.js';
import { metersToSimUnits, simUnitsToMeters } from '../units.js';
import { pointAt } from '../trackModel.js';

const TIMING_HISTORY_WINDOW_SECONDS = 18;
const TIMING_HISTORY_MAX_SAMPLES = 720;
const TIMING_LINE_TARGET_SPACING_METERS = 175;
const TIMING_LINE_HISTORY_LAPS = 3;
const TELEMETRY_SECTOR_COUNT = 3;

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function createEmptySectorTimes() {
  return Array.from({ length: TELEMETRY_SECTOR_COUNT }, () => null);
}

function createEmptySectorPerformance() {
  return {
    current: createEmptySectorTimes(),
    last: createEmptySectorTimes(),
    best: createEmptySectorTimes(),
  };
}

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

function serializeSectorTimes(values) {
  return createEmptySectorTimes().map((_, index) => finiteOrNull(values?.[index]));
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

function serializeSectorPerformance(values) {
  return createEmptySectorTimes().map((_, index) => values?.[index] ?? null);
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

function syncLiveSectorTelemetry(telemetry, track) {
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
  syncLiveSectorTelemetry(telemetry, track);
}

function classifySectorPerformance(value, personalBest, overallBest) {
  if (!Number.isFinite(value)) return null;
  if (Number.isFinite(overallBest) && Math.abs(value - overallBest) <= 1e-6) return 'overall-best';
  if (Number.isFinite(personalBest) && Math.abs(value - personalBest) <= 1e-6) return 'personal-best';
  return 'slower';
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

export function trimTimingHistory(history, currentTime) {
  const cutoff = currentTime - TIMING_HISTORY_WINDOW_SECONDS;
  while (history.length > 2 && (history[0].time < cutoff || history.length > TIMING_HISTORY_MAX_SAMPLES)) {
    history.shift();
  }
}

export function resetTimingHistory(car, currentTime) {
  car.timingHistory = [{ time: currentTime, raceDistance: car.raceDistance }];
}

export function recordTimingSample(car, currentTime) {
  if (!Number.isFinite(car.raceDistance)) return;
  if (!Array.isArray(car.timingHistory)) {
    resetTimingHistory(car, currentTime);
    return;
  }

  const previous = car.timingHistory[car.timingHistory.length - 1];
  if (
    previous &&
    Math.abs(previous.time - currentTime) <= 1e-6 &&
    Math.abs(previous.raceDistance - car.raceDistance) <= 1e-3
  ) {
    return;
  }

  car.timingHistory.push({ time: currentTime, raceDistance: car.raceDistance });
  trimTimingHistory(car.timingHistory, currentTime);
}

function interpolateTimeAtDistance(history, targetDistance) {
  if (!Array.isArray(history) || history.length < 2) return null;
  for (let index = history.length - 1; index > 0; index -= 1) {
    const current = history[index];
    const previous = history[index - 1];
    if (targetDistance < previous.raceDistance || targetDistance > current.raceDistance) continue;
    const coveredDistance = current.raceDistance - previous.raceDistance;
    if (coveredDistance <= 1e-6) return current.time;
    const ratio = (targetDistance - previous.raceDistance) / coveredDistance;
    return previous.time + (current.time - previous.time) * ratio;
  }
  return null;
}

export function estimateGapAheadSeconds(ahead, car, currentTime, track) {
  if (!ahead) return Infinity;
  const timingLineGap = estimateTimingLineGapSeconds(ahead, car, currentTime, track);
  if (Number.isFinite(timingLineGap)) return timingLineGap;

  const crossingTime = interpolateTimeAtDistance(ahead.timingHistory, car.raceDistance);
  if (Number.isFinite(crossingTime)) {
    return Math.max(0, currentTime - crossingTime);
  }
  const speedReference = Math.max((ahead.speed + car.speed) * 0.5, 1);
  return Math.max(0, (ahead.raceDistance - car.raceDistance) / speedReference);
}

export function wholeLapGap(aheadDistance, carDistance, trackLength) {
  if (!Number.isFinite(aheadDistance) || !Number.isFinite(carDistance)) return 0;
  if (!Number.isFinite(trackLength) || trackLength <= 0) return 0;
  return Math.max(0, Math.floor((aheadDistance - carDistance + 1e-6) / trackLength));
}

export function createTimingLines(track) {
  const targetSpacing = metersToSimUnits(TIMING_LINE_TARGET_SPACING_METERS);
  const count = Math.max(1, Math.round(track.length / targetSpacing));
  const spacing = track.length / count;
  return {
    spacing,
    spacingMeters: simUnitsToMeters(spacing),
    count,
    lines: Array.from({ length: count }, (_, index) => {
      const distance = index * spacing;
      const point = pointAt(track, distance);
      return {
        index,
        distance,
        distanceMeters: simUnitsToMeters(distance),
        x: point.x,
        y: point.y,
        heading: point.heading,
      };
    }),
  };
}

export function getTimingLineNumber(track, raceDistance) {
  const spacing = track.timingLines?.spacing;
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(raceDistance)) return null;
  return Math.floor(Math.max(0, raceDistance) / spacing);
}

export function resetTimingLineCrossings(car, currentTime) {
  car.timingLineCrossings = Object.create(null);
  car.timingLineLastUpdatedAt = currentTime;
  car.previousRaceDistanceForTiming = car.raceDistance;
}

export function recordTimingLineCrossings(car, previousRaceDistance, currentTime, track) {
  const spacing = track.timingLines?.spacing;
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(car.raceDistance)) return;
  if (!car.timingLineCrossings || typeof car.timingLineCrossings !== 'object') {
    resetTimingLineCrossings(car, currentTime);
    return;
  }

  const previousDistance = Number.isFinite(previousRaceDistance) ? previousRaceDistance : car.raceDistance;
  const currentDistance = car.raceDistance;
  const travelled = currentDistance - previousDistance;
  const previousTime = Number.isFinite(car.timingLineLastUpdatedAt) ? car.timingLineLastUpdatedAt : currentTime;
  const elapsed = Math.max(0, currentTime - previousTime);

  if (travelled > 1e-6 && travelled < track.length / 2) {
    const firstLine = Math.floor(Math.max(0, previousDistance) / spacing) + 1;
    const lastLine = Math.floor(Math.max(0, currentDistance) / spacing);
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
      const lineDistance = lineNumber * spacing;
      if (lineDistance <= previousDistance + 1e-6 || lineDistance > currentDistance + 1e-6) continue;
      const ratio = clamp((lineDistance - previousDistance) / travelled, 0, 1);
      car.timingLineCrossings[lineNumber] = previousTime + ratio * elapsed;
    }
  }

  car.timingLineLastUpdatedAt = currentTime;
  const latestLine = getTimingLineNumber(track, currentDistance);
  if (latestLine != null) {
    const cutoff = latestLine - (track.timingLines.count * TIMING_LINE_HISTORY_LAPS);
    Object.keys(car.timingLineCrossings).forEach((key) => {
      if (Number(key) < cutoff) delete car.timingLineCrossings[key];
    });
  }
}

function getTimingLineCrossingTime(car, lineNumber) {
  const value = car?.timingLineCrossings?.[lineNumber];
  return Number.isFinite(value) ? value : null;
}

export function estimateTimingLineGapSeconds(ahead, car, currentTime, track) {
  if (!ahead || !car) return Infinity;
  const currentLine = getTimingLineNumber(track, Math.min(ahead.raceDistance ?? 0, car.raceDistance ?? 0));
  if (currentLine == null) return null;
  const oldestLine = Math.max(0, currentLine - (track.timingLines?.count ?? 0));

  for (let lineNumber = currentLine; lineNumber >= oldestLine; lineNumber -= 1) {
    const aheadTime = getTimingLineCrossingTime(ahead, lineNumber);
    const carTime = getTimingLineCrossingTime(car, lineNumber);
    if (Number.isFinite(aheadTime) && Number.isFinite(carTime)) {
      return Math.max(0, carTime - aheadTime);
    }
  }

  return null;
}
