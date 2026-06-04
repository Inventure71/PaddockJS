import { wrapDistance } from '../simMath.js';

function wrapProgress(value, length) {
  return wrapDistance(value, length);
}

function distanceForward(from, to, length) {
  return wrapProgress(to - from, length);
}

function crossesDistance(previous, current, target, length) {
  const travelled = distanceForward(previous, current, length);
  if (travelled <= 0 || travelled > length / 2) return false;
  const targetOffset = distanceForward(previous, target, length);
  return targetOffset > 0 && targetOffset <= travelled + 0.001;
}

function isProgressInZone(track, progress, zone) {
  const wrapped = wrapProgress(progress, track.length);
  const start = wrapProgress(zone.start, track.length);
  const end = wrapProgress(zone.end, track.length);
  if (zone.end - zone.start >= track.length) return true;
  return end >= start
    ? wrapped >= start && wrapped <= end
    : wrapped >= start || wrapped <= end;
}

function getZoneById(zones, zoneId) {
  for (let index = 0; index < zones.length; index += 1) {
    if (zones[index].id === zoneId) return zones[index];
  }
  return null;
}

function findNextDrsZoneIndex(track, progress) {
  const zones = track?.drsZones ?? [];
  if (!zones.length) return -1;
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < zones.length; index += 1) {
    const distance = distanceForward(progress, zones[index].start, track.length);
    if (distance <= 1e-6 || distance >= bestDistance) continue;
    bestDistance = distance;
    bestIndex = index;
  }
  return bestIndex >= 0 ? bestIndex : 0;
}

function resolveNextDrsZone(track, car, progress, runtimeBenchmarkStats = null) {
  const zones = track?.drsZones ?? [];
  if (!zones.length) {
    car._drsNextZoneIndex = null;
    return null;
  }
  const cachedIndex = car._drsNextZoneIndex;
  if (Number.isInteger(cachedIndex) && cachedIndex >= 0 && cachedIndex < zones.length) {
    if (runtimeBenchmarkStats) {
      runtimeBenchmarkStats.drsNextZoneCacheHits = (runtimeBenchmarkStats.drsNextZoneCacheHits ?? 0) + 1;
    }
    return zones[cachedIndex];
  }
  const nextIndex = findNextDrsZoneIndex(track, progress);
  car._drsNextZoneIndex = nextIndex;
  if (runtimeBenchmarkStats) {
    runtimeBenchmarkStats.drsNextZoneScans = (runtimeBenchmarkStats.drsNextZoneScans ?? 0) + 1;
  }
  return nextIndex >= 0 ? zones[nextIndex] : null;
}

function tryCachedDrsZoneNoCrossingFastPath(track, car, runtimeBenchmarkStats = null) {
  const zones = track?.drsZones ?? [];
  const cachedIndex = car._drsNextZoneIndex;
  if (!Number.isInteger(cachedIndex) || cachedIndex < 0 || cachedIndex >= zones.length) return false;

  const previousProgress = car.previousProgress ?? car.progress;
  const travelled = car.progress - previousProgress;
  if (travelled <= 0 || travelled > track.length / 2) return false;

  const startOffset = zones[cachedIndex].start - previousProgress;
  if (startOffset > 0 && startOffset <= travelled + 0.001) return false;

  if (runtimeBenchmarkStats) {
    runtimeBenchmarkStats.drsNextZoneCacheHits = (runtimeBenchmarkStats.drsNextZoneCacheHits ?? 0) + 1;
    runtimeBenchmarkStats.drsNextZoneFastPathChecks = (runtimeBenchmarkStats.drsNextZoneFastPathChecks ?? 0) + 1;
  }
  return true;
}

export function recordDrsDetection(car, zoneId, currentTime) {
  const detections = car.drsDetection ?? (car.drsDetection = {});
  const next = detections[zoneId] ?? { passage: 0, time: -Infinity };
  next.passage += 1;
  next.time = currentTime;
  detections[zoneId] = next;
  return next;
}

function updateDrsLatchCore(
  car,
  ahead,
  hasReference,
  safetyCarDeployed,
  time,
  track,
  rules,
  runtimeBenchmarkStats = null,
) {
  if (safetyCarDeployed || car.finished) {
    car.drsEligible = false;
    car.drsActive = false;
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car._drsZoneRef = null;
    return;
  }

  const previousProgress = car.previousProgress ?? car.progress;
  const zones = track.drsZones;
  let activeZone = null;
  if (car.drsZoneId) {
    activeZone = car._drsZoneRef?.id === car.drsZoneId ? car._drsZoneRef : null;
    if (!activeZone) {
      activeZone = getZoneById(zones, car.drsZoneId);
      if (activeZone) car._drsZoneRef = activeZone;
    }
  }

  if (activeZone && !isProgressInZone(track, car.progress, activeZone)) {
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car._drsZoneRef = null;
    activeZone = null;
  }

  if (!car.drsZoneId) {
    if (tryCachedDrsZoneNoCrossingFastPath(track, car, runtimeBenchmarkStats)) {
      car.drsEligible = false;
      car.drsActive = false;
      return;
    }
    const crossedZone = resolveNextDrsZone(track, car, previousProgress, runtimeBenchmarkStats);
    if (crossedZone) {
      const nextZoneIndex = car._drsNextZoneIndex;
      if (crossesDistance(previousProgress, car.progress, crossedZone.start, track.length)) {
        car.drsZoneId = crossedZone.id;
        car._drsZoneRef = crossedZone;
        activeZone = crossedZone;
        if (Number.isInteger(nextZoneIndex) && nextZoneIndex >= 0 && nextZoneIndex < zones.length) {
          car._drsNextZoneIndex = findNextDrsZoneIndex(track, car.progress);
        }
        const crossing = recordDrsDetection(car, crossedZone.id, time);
        const aheadCrossing = ahead?.drsDetection?.[crossedZone.id];
        car.drsZoneEnabled = Boolean(
          hasReference &&
          aheadCrossing &&
          aheadCrossing.passage === crossing.passage &&
          crossing.time >= aheadCrossing.time &&
          crossing.time - aheadCrossing.time <= rules.drsDetectionSeconds + 1e-6
        );
      }
    }
  }

  const inLatchedZone = activeZone ? isProgressInZone(track, car.progress, activeZone) : false;
  car.drsEligible = Boolean(car.drsZoneEnabled && inLatchedZone);
  car.drsActive = car.drsEligible;
}

export function updateDrsLatch(car, ahead, {
  hasReference = Boolean(ahead),
  safetyCarDeployed = false,
  time,
  track,
  rules,
  runtimeBenchmarkStats = null,
} = {}) {
  return updateDrsLatchCore(
    car,
    ahead,
    hasReference,
    safetyCarDeployed,
    time,
    track,
    rules,
    runtimeBenchmarkStats,
  );
}

export function updateDrsLatchForSimulation(sim, car, ahead, hasReference = Boolean(ahead)) {
  return updateDrsLatchCore(
    car,
    ahead,
    hasReference,
    sim.safetyCar.deployed,
    sim.time,
    sim.track,
    sim.rules,
    sim.runtimeBenchmarkStats,
  );
}
