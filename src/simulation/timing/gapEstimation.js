import { interpolateTimeAtDistance } from './timingHistory.js';
import { getTimingLineCrossingTime, getTimingLineNumber } from './timingLines.js';

export function estimateGapAheadSeconds(ahead, car, currentTime, track) {
  if (!ahead) return Infinity;
  const aheadLastStored = ahead.timingLineLastStored;
  const carLastStored = car.timingLineLastStored;
  if (Number.isInteger(aheadLastStored) && Number.isInteger(carLastStored)) {
    const timingLineGap = estimateTimingLineGapSeconds(ahead, car, currentTime, track);
    if (Number.isFinite(timingLineGap)) return timingLineGap;
  }

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

export function estimateTimingLineGapSeconds(ahead, car, currentTime, track) {
  if (!ahead || !car) return Infinity;
  const aheadLastStored = ahead.timingLineLastStored;
  const carLastStored = car.timingLineLastStored;
  if (!Number.isInteger(aheadLastStored) || !Number.isInteger(carLastStored)) return null;
  const aheadFirstStored = ahead.timingLineFirstStored;
  const carFirstStored = car.timingLineFirstStored;
  if (!Number.isInteger(aheadFirstStored) || !Number.isInteger(carFirstStored)) return null;
  const currentLine = getTimingLineNumber(track, Math.min(ahead.raceDistance ?? 0, car.raceDistance ?? 0));
  if (currentLine == null) return null;
  const oldestLine = Math.max(0, currentLine - (track.timingLines?.count ?? 0));
  const startLine = Math.min(
    currentLine,
    aheadLastStored,
    carLastStored,
  );
  const earliestLine = Math.max(
    oldestLine,
    aheadFirstStored,
    carFirstStored,
  );

  if (startLine < earliestLine) return null;

  for (let lineNumber = startLine; lineNumber >= earliestLine; lineNumber -= 1) {
    const aheadTime = getTimingLineCrossingTime(ahead, lineNumber);
    const carTime = getTimingLineCrossingTime(car, lineNumber);
    if (Number.isFinite(aheadTime) && Number.isFinite(carTime)) {
      return Math.max(0, carTime - aheadTime);
    }
  }

  return null;
}
