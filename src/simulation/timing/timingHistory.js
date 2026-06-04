import { TIMING_HISTORY_MAX_SAMPLES, TIMING_HISTORY_WINDOW_SECONDS } from './timingConstants.js';

const TIMING_HISTORY_START_INDEX = '_startIndex';
const TIMING_HISTORY_COUNT = '_count';
const TIMING_HISTORY_INTERPOLATION_OFFSET = '_interpolationOffset';
const TIMING_HISTORY_INTERPOLATION_LOWER_DISTANCE = '_interpolationLowerDistance';
const TIMING_HISTORY_INTERPOLATION_UPPER_DISTANCE = '_interpolationUpperDistance';
const TIMING_HISTORY_INTERPOLATION_LOWER_TIME = '_interpolationLowerTime';
const TIMING_HISTORY_INTERPOLATION_UPPER_TIME = '_interpolationUpperTime';
const TIMING_HISTORY_INTERPOLATION_STATS = '_interpolationStats';

function isStructuredTimingHistory(history) {
  return Boolean(
    history &&
    history.times instanceof Float64Array &&
    history.distances instanceof Float64Array,
  );
}

function createStructuredTimingHistory(currentTime, raceDistance) {
  const history = {
    times: new Float64Array(TIMING_HISTORY_MAX_SAMPLES),
    distances: new Float64Array(TIMING_HISTORY_MAX_SAMPLES),
  };
  history.times[0] = currentTime;
  history.distances[0] = raceDistance;
  history[TIMING_HISTORY_START_INDEX] = 0;
  history[TIMING_HISTORY_COUNT] = 1;
  return history;
}

function getTimingHistoryStartIndex(history) {
  if (isStructuredTimingHistory(history)) {
    const value = history[TIMING_HISTORY_START_INDEX];
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }
  const value = history?.[TIMING_HISTORY_START_INDEX];
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function setTimingHistoryStartIndex(history, startIndex) {
  if (isStructuredTimingHistory(history)) {
    history[TIMING_HISTORY_START_INDEX] = startIndex;
    return;
  }
  Object.defineProperty(history, TIMING_HISTORY_START_INDEX, {
    value: startIndex,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

function clearTimingHistoryStartIndex(history) {
  if (isStructuredTimingHistory(history)) {
    history[TIMING_HISTORY_START_INDEX] = 0;
    return;
  }
  delete history[TIMING_HISTORY_START_INDEX];
}

function activeTimingHistoryLength(history, startIndex = getTimingHistoryStartIndex(history)) {
  if (isStructuredTimingHistory(history)) {
    const count = history[TIMING_HISTORY_COUNT];
    return Number.isInteger(count) && count >= 0 ? count : 0;
  }
  return Math.max(0, history.length - startIndex);
}

function compactTimingHistory(history, startIndex) {
  if (isStructuredTimingHistory(history)) {
    history[TIMING_HISTORY_START_INDEX] = startIndex;
    return;
  }
  if (startIndex <= 0) {
    clearTimingHistoryStartIndex(history);
    return;
  }
  history.splice(0, startIndex);
  clearTimingHistoryStartIndex(history);
}

function trimStructuredTimingHistory(history, currentTime) {
  let startIndex = getTimingHistoryStartIndex(history);
  let count = activeTimingHistoryLength(history, startIndex);
  const cutoff = currentTime - TIMING_HISTORY_WINDOW_SECONDS;
  while (
    count > 2 &&
    history.times[startIndex] < cutoff
  ) {
    startIndex = (startIndex + 1) % TIMING_HISTORY_MAX_SAMPLES;
    count -= 1;
  }
  history[TIMING_HISTORY_START_INDEX] = startIndex;
  history[TIMING_HISTORY_COUNT] = count;
}

export function trimTimingHistory(history, currentTime) {
  if (isStructuredTimingHistory(history)) {
    trimStructuredTimingHistory(history, currentTime);
    return;
  }
  if (!Array.isArray(history)) return;
  const cutoff = currentTime - TIMING_HISTORY_WINDOW_SECONDS;
  let startIndex = getTimingHistoryStartIndex(history);
  if (
    startIndex === 0 &&
    history.length <= TIMING_HISTORY_MAX_SAMPLES &&
    history.length <= 2
  ) return;
  if (
    startIndex === 0 &&
    history.length <= TIMING_HISTORY_MAX_SAMPLES &&
    history[0]?.time >= cutoff
  ) return;
  while (
    activeTimingHistoryLength(history, startIndex) > 2 &&
    (
      history[startIndex]?.time < cutoff ||
      activeTimingHistoryLength(history, startIndex) > TIMING_HISTORY_MAX_SAMPLES
    )
  ) {
    startIndex += 1;
  }
  if (startIndex > 0 && (startIndex >= 64 || startIndex * 2 >= history.length)) {
    compactTimingHistory(history, startIndex);
    return;
  }
  if (startIndex > 0) setTimingHistoryStartIndex(history, startIndex);
  else clearTimingHistoryStartIndex(history);
}

export function resetTimingHistory(car, currentTime) {
  car.timingHistory = createStructuredTimingHistory(currentTime, car.raceDistance);
}

export function recordTimingSample(car, currentTime) {
  if (!Number.isFinite(car.raceDistance)) return;
  if (!isStructuredTimingHistory(car.timingHistory)) {
    resetTimingHistory(car, currentTime);
  }
  const history = car.timingHistory;
  const startIndex = getTimingHistoryStartIndex(history);
  const count = activeTimingHistoryLength(history, startIndex);
  const previousIndex = count > 0
    ? (startIndex + count - 1) % TIMING_HISTORY_MAX_SAMPLES
    : 0;
  const previousTime = count > 0 ? history.times[previousIndex] : null;
  const previousRaceDistance = count > 0 ? history.distances[previousIndex] : null;
  if (
    count > 0 &&
    Math.abs(previousTime - currentTime) <= 1e-6 &&
    Math.abs(previousRaceDistance - car.raceDistance) <= 1e-3
  ) {
    return;
  }

  let nextStartIndex = startIndex;
  let nextCount = count;
  let writeIndex = 0;
  if (nextCount < TIMING_HISTORY_MAX_SAMPLES) {
    writeIndex = (nextStartIndex + nextCount) % TIMING_HISTORY_MAX_SAMPLES;
    nextCount += 1;
  } else {
    writeIndex = nextStartIndex;
    nextStartIndex = (nextStartIndex + 1) % TIMING_HISTORY_MAX_SAMPLES;
  }
  history.times[writeIndex] = currentTime;
  history.distances[writeIndex] = car.raceDistance;
  history[TIMING_HISTORY_START_INDEX] = nextStartIndex;
  history[TIMING_HISTORY_COUNT] = nextCount;
  trimStructuredTimingHistory(history, currentTime);
}

export function interpolateTimeAtDistance(history, targetDistance) {
  if (isStructuredTimingHistory(history)) {
    const directCachedTime = interpolateDirectCachedSegment(history, targetDistance);
    if (Number.isFinite(directCachedTime)) return directCachedTime;
    const startIndex = getTimingHistoryStartIndex(history);
    const count = activeTimingHistoryLength(history, startIndex);
    if (count < 2) return null;
    const cachedOffset = history[TIMING_HISTORY_INTERPOLATION_OFFSET];
    if (Number.isInteger(cachedOffset) && cachedOffset >= 0 && cachedOffset < count - 1) {
      const cachedTime = interpolateStructuredTimingHistoryAtOffset(history, startIndex, count, targetDistance, cachedOffset);
      if (Number.isFinite(cachedTime)) return cachedTime;
      const resolvedOffset = history[TIMING_HISTORY_INTERPOLATION_OFFSET];
      if (Number.isInteger(resolvedOffset) && resolvedOffset >= 0 && resolvedOffset < count - 1) {
        const currentPosition = count - 1 - resolvedOffset;
        const currentIndex = (startIndex + currentPosition) % TIMING_HISTORY_MAX_SAMPLES;
        const previousIndex = (startIndex + currentPosition - 1) % TIMING_HISTORY_MAX_SAMPLES;
        const currentDistance = history.distances[currentIndex];
        const previousDistance = history.distances[previousIndex];
        if (targetDistance > currentDistance) {
          for (let offset = resolvedOffset - 1; offset >= 0; offset -= 1) {
            const value = interpolateStructuredTimingHistoryAtOffset(history, startIndex, count, targetDistance, offset);
            if (Number.isFinite(value)) return value;
          }
        } else if (targetDistance < previousDistance) {
          for (let offset = resolvedOffset + 1; offset < count - 1; offset += 1) {
            const value = interpolateStructuredTimingHistoryAtOffset(history, startIndex, count, targetDistance, offset);
            if (Number.isFinite(value)) return value;
          }
        }
      }
    }
    for (let offset = 0; offset < count - 1; offset += 1) {
      const value = interpolateStructuredTimingHistoryAtOffset(history, startIndex, count, targetDistance, offset);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }
  if (!Array.isArray(history)) return null;
  const startIndex = getTimingHistoryStartIndex(history);
  if (activeTimingHistoryLength(history, startIndex) < 2) return null;
  for (let index = history.length - 1; index > startIndex; index -= 1) {
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

function interpolateStructuredTimingHistoryAtOffset(history, startIndex, count, targetDistance, offsetFromTail) {
  const currentPosition = count - 1 - offsetFromTail;
  const currentIndex = (startIndex + currentPosition) % TIMING_HISTORY_MAX_SAMPLES;
  const previousIndex = (startIndex + currentPosition - 1) % TIMING_HISTORY_MAX_SAMPLES;
  const currentDistance = history.distances[currentIndex];
  const previousDistance = history.distances[previousIndex];
  if (targetDistance < previousDistance || targetDistance > currentDistance) return null;
  history[TIMING_HISTORY_INTERPOLATION_OFFSET] = offsetFromTail;
  history[TIMING_HISTORY_INTERPOLATION_LOWER_DISTANCE] = previousDistance;
  history[TIMING_HISTORY_INTERPOLATION_UPPER_DISTANCE] = currentDistance;
  history[TIMING_HISTORY_INTERPOLATION_LOWER_TIME] = history.times[previousIndex];
  history[TIMING_HISTORY_INTERPOLATION_UPPER_TIME] = history.times[currentIndex];
  const coveredDistance = currentDistance - previousDistance;
  if (coveredDistance <= 1e-6) return history.times[currentIndex];
  const ratio = (targetDistance - previousDistance) / coveredDistance;
  return history.times[previousIndex] + (history.times[currentIndex] - history.times[previousIndex]) * ratio;
}

function interpolateDirectCachedSegment(history, targetDistance) {
  const lowerDistance = history[TIMING_HISTORY_INTERPOLATION_LOWER_DISTANCE];
  const upperDistance = history[TIMING_HISTORY_INTERPOLATION_UPPER_DISTANCE];
  if (!Number.isFinite(lowerDistance) || !Number.isFinite(upperDistance)) return null;
  if (targetDistance < lowerDistance || targetDistance > upperDistance) return null;

  const lowerTime = history[TIMING_HISTORY_INTERPOLATION_LOWER_TIME];
  const upperTime = history[TIMING_HISTORY_INTERPOLATION_UPPER_TIME];
  const stats = history[TIMING_HISTORY_INTERPOLATION_STATS];
  if (stats) {
    stats.directSegmentCacheHits = (stats.directSegmentCacheHits ?? 0) + 1;
  }
  const coveredDistance = upperDistance - lowerDistance;
  if (coveredDistance <= 1e-6) return upperTime;
  const ratio = (targetDistance - lowerDistance) / coveredDistance;
  return lowerTime + (upperTime - lowerTime) * ratio;
}
