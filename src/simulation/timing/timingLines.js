import { clamp } from '../simMath.js';
import { metersToSimUnits, simUnitsToMeters } from '../units.js';
import { pointAt } from '../track/trackModel.js';
import { TIMING_LINE_HISTORY_LAPS, TIMING_LINE_TARGET_SPACING_METERS } from './timingConstants.js';

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

export function getTimingLineCrossingTime(car, lineNumber) {
  const value = car?.timingLineCrossings?.[lineNumber];
  return Number.isFinite(value) ? value : null;
}
