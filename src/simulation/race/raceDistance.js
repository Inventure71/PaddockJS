import { clamp, wrapDistance } from '../simMath.js';

const MIN_TOTAL_LAPS = 1;

export function normalizeTotalLaps(value, { minimum = MIN_TOTAL_LAPS } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.max(minimum, Math.floor(numeric));
}

export function wrapProgress(value, length) {
  return wrapDistance(value, length);
}

export function distanceForward(from, to, length) {
  return wrapProgress(to - from, length);
}

export function progressDelta(a, b, trackLength) {
  let delta = a - b;
  if (delta < -trackLength / 2) delta += trackLength;
  if (delta > trackLength / 2) delta -= trackLength;
  return delta;
}

export function computeLapForDistance(raceDistance, trackLength, totalLaps) {
  return clamp(Math.floor(Math.max(0, raceDistance) / trackLength) + 1, 1, totalLaps);
}

export function finishDistanceForRace(trackLength, totalLaps) {
  return trackLength * totalLaps;
}
