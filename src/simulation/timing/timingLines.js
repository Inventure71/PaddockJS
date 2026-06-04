import { clamp } from '../simMath.js';
import { metersToSimUnits, simUnitsToMeters } from '../units.js';
import { pointAt } from '../track/trackModel.js';
import { TIMING_LINE_HISTORY_LAPS, TIMING_LINE_TARGET_SPACING_METERS } from './timingConstants.js';

function setTimingLineCrossingBounds(car, firstLine, lastLine) {
  car.timingLineFirstStored = Number.isInteger(firstLine) ? firstLine : null;
  car.timingLineLastStored = Number.isInteger(lastLine) ? lastLine : null;
}

function ensureTimingLineCrossingBounds(car) {
  if (Number.isInteger(car.timingLineFirstStored) && Number.isInteger(car.timingLineLastStored)) {
    return {
      firstLine: car.timingLineFirstStored,
      lastLine: car.timingLineLastStored,
    };
  }
  const lineNumbers = Object.keys(car.timingLineCrossings)
    .map((key) => Number(key))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const firstLine = lineNumbers[0];
  const lastLine = lineNumbers[lineNumbers.length - 1];
  setTimingLineCrossingBounds(car, firstLine, lastLine);
  return {
    firstLine: car.timingLineFirstStored,
    lastLine: car.timingLineLastStored,
  };
}

function setTimingLineCrossing(car, lineNumber, crossingTime) {
  car.timingLineCrossings[lineNumber] = crossingTime;
  const firstLine = car.timingLineFirstStored;
  const lastLine = car.timingLineLastStored;
  if (!Number.isInteger(firstLine) || lineNumber < firstLine) car.timingLineFirstStored = lineNumber;
  if (!Number.isInteger(lastLine) || lineNumber > lastLine) car.timingLineLastStored = lineNumber;
}

function pruneTimingLineCrossings(car, cutoffLine) {
  const { firstLine, lastLine } = ensureTimingLineCrossingBounds(car);
  if (!Number.isInteger(firstLine) || !Number.isInteger(lastLine) || cutoffLine <= firstLine) return;
  const pruneEnd = Math.min(lastLine, cutoffLine - 1);
  for (let lineNumber = firstLine; lineNumber <= pruneEnd; lineNumber += 1) {
    delete car.timingLineCrossings[lineNumber];
  }
  if (cutoffLine > lastLine) {
    setTimingLineCrossingBounds(car, null, null);
    return;
  }
  setTimingLineCrossingBounds(car, cutoffLine, lastLine);
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
  setTimingLineCrossingBounds(car, null, null);
  car.timingLinePruneCutoff = null;
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
  const latestLine = getTimingLineNumber(track, currentDistance);
  const cutoff = latestLine != null
    ? latestLine - (track.timingLines.count * TIMING_LINE_HISTORY_LAPS)
    : null;

  if (Math.abs(travelled) <= 1e-6) {
    car.timingLineLastUpdatedAt = currentTime;
    if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff === car.timingLinePruneCutoff) return;
    pruneTimingLineCrossings(car, cutoff);
    car.timingLinePruneCutoff = cutoff;
    return;
  }

  if (travelled > 1e-6 && travelled < track.length / 2) {
    const firstLine = Math.floor(Math.max(0, previousDistance) / spacing) + 1;
    const lastLine = Math.floor(Math.max(0, currentDistance) / spacing);
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
      const lineDistance = lineNumber * spacing;
      if (lineDistance <= previousDistance + 1e-6 || lineDistance > currentDistance + 1e-6) continue;
      const ratio = clamp((lineDistance - previousDistance) / travelled, 0, 1);
      setTimingLineCrossing(car, lineNumber, previousTime + ratio * elapsed);
    }
  }

  car.timingLineLastUpdatedAt = currentTime;
  if (Number.isFinite(cutoff) && cutoff > 0 && cutoff !== car.timingLinePruneCutoff) {
    pruneTimingLineCrossings(car, cutoff);
    car.timingLinePruneCutoff = cutoff;
  }
}

export function getTimingLineCrossingTime(car, lineNumber) {
  const value = car?.timingLineCrossings?.[lineNumber];
  return Number.isFinite(value) ? value : null;
}
