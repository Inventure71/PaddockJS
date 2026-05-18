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

export function recordDrsDetection(car, zoneId, currentTime) {
  const previous = car.drsDetection?.[zoneId] ?? { passage: 0, time: -Infinity };
  const next = { passage: previous.passage + 1, time: currentTime };
  car.drsDetection = {
    ...(car.drsDetection ?? {}),
    [zoneId]: next,
  };
  return next;
}

export function updateDrsLatch(car, ahead, {
  hasReference = Boolean(ahead),
  safetyCarDeployed = false,
  time,
  track,
  rules,
} = {}) {
  if (safetyCarDeployed || car.finished) {
    car.drsEligible = false;
    car.drsActive = false;
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    return;
  }

  const previousProgress = car.previousProgress ?? car.progress;
  const currentZone = car.drsZoneId
    ? track.drsZones.find((zone) => zone.id === car.drsZoneId)
    : null;

  if (currentZone && !isProgressInZone(track, car.progress, currentZone)) {
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
  }

  if (!car.drsZoneId) {
    const crossedZone = track.drsZones.find((zone) => (
      crossesDistance(previousProgress, car.progress, zone.start, track.length)
    ));
    if (crossedZone) {
      car.drsZoneId = crossedZone.id;
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

  const activeZone = car.drsZoneId
    ? track.drsZones.find((zone) => zone.id === car.drsZoneId)
    : null;
  const inLatchedZone = activeZone ? isProgressInZone(track, car.progress, activeZone) : false;
  car.drsEligible = Boolean(car.drsZoneEnabled && inLatchedZone);
  car.drsActive = car.drsEligible;
}
