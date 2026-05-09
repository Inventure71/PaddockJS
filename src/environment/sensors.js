import { nearestTrackState } from '../simulation/trackModel.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import { VEHICLE_GEOMETRY } from '../simulation/vehicleGeometry.js';

const TRACK_RAY_STEP_METERS = 1;
const TRACK_RAY_REFINE_STEPS = 12;
const ANALYTIC_TRACK_RAY_MAX_CURVATURE = 0.00005;
const PIT_CONNECTOR_RAY_FALLBACK_METERS = 55;
export const DEFAULT_RAY_ANGLES_DEGREES = [-135, -60, -20, 0, 20, 60, 135, 180];

export function buildNearbyCars(car, snapshot, { maxCars = 6, radiusMeters = 150 } = {}) {
  const limit = Math.max(0, Math.floor(maxCars));
  if (limit === 0) return [];
  const radius = metersToSimUnits(radiusMeters);
  const radiusSquared = radius * radius;
  const forwardX = Math.cos(car.heading);
  const forwardY = Math.sin(car.heading);
  const rightX = -Math.sin(car.heading);
  const rightY = Math.cos(car.heading);
  const nearest = [];

  snapshot.cars.forEach((other, order) => {
    if (other.id === car.id) return;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > radiusSquared) return;

    const forward = forwardX * dx + forwardY * dy;
    const right = rightX * dx + rightY * dy;
    const entry = {
      id: other.id,
      relativeForwardMeters: simUnitsToMeters(forward),
      relativeRightMeters: simUnitsToMeters(right),
      relativeDistanceMeters: simUnitsToMeters(Math.sqrt(distanceSquared)),
      relativeSpeedKph: other.speedKph - car.speedKph,
      relativeHeadingRadians: normalizeRelativeHeading(other.heading - car.heading),
      ahead: forward > 0,
      sameLap: other.lap === car.lap,
      distanceSquared,
      order,
    };
    insertNearestCar(nearest, entry, limit);
  });

  return nearest.map(({ distanceSquared, order, ...entry }) => entry);
}

export function buildRaySensors(car, snapshot, rayOptions = {}) {
  const angles = rayOptions.anglesDegrees ?? DEFAULT_RAY_ANGLES_DEGREES;
  const lengthMeters = rayOptions.lengthMeters ?? 120;
  const origin = getCarRayOrigin(car);
  const trackContext = rayOptions.detectTrack === false
    ? null
    : createTrackRayContext(car, snapshot, origin);

  return angles.map((angleDegrees) => ({
    angleDegrees,
    angleRadians: degreesToRadians(angleDegrees),
    lengthMeters,
    track: rayOptions.detectTrack === false
      ? createTrackMiss(lengthMeters)
      : estimateTrackHit(car, snapshot, angleDegrees, lengthMeters, trackContext),
    car: rayOptions.detectCars === false
      ? { hit: false, distanceMeters: lengthMeters, driverId: null, relativeSpeedKph: 0 }
      : estimateCarHit(car, snapshot, angleDegrees, lengthMeters, origin),
  }));
}

function createTrackRayContext(car, snapshot, origin) {
  if (!Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return { origin, originState: null };
  }
  return {
    origin,
    originState: nearestTrackState(snapshot.track, origin, car.progress),
  };
}

function estimateTrackHit(car, snapshot, angleDegrees, lengthMeters, context = null) {
  if (!Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return estimateLocalTrackHit(car, snapshot, angleDegrees, lengthMeters);
  }

  const origin = context?.origin ?? getCarRayOrigin(car);
  const ray = getCarRayVector(car, angleDegrees);
  const maxDistance = metersToSimUnits(lengthMeters);
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  const originState = context?.originState ?? nearestTrackState(snapshot.track, origin, car.progress);
  const includePitLane = Boolean(car.inPitLane || car.pitLanePart || originState.inPitLane);
  const analyticHit = estimateAnalyticMainTrackHit({
    car,
    track: snapshot.track,
    originState,
    ray,
    lengthMeters,
    includePitLane,
  });
  if (analyticHit) return analyticHit;
  let previousDistance = 0;
  let previousInside = null;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const state = nearestTrackState(snapshot.track, pointOnRay(origin, ray, distance), car.progress);
    const inside = isInsideTrackBorder(state, snapshot.track, includePitLane);
    if (previousInside == null) {
      previousInside = inside;
      previousDistance = distance;
      continue;
    }

    if (inside !== previousInside) {
      const kind = previousInside ? 'exit' : 'entry';
      const hitDistance = refineTrackTransitionDistance(
        snapshot.track,
        origin,
        ray,
        car.progress,
        previousDistance,
        distance,
        kind,
        includePitLane,
      );
      return {
        hit: true,
        distanceMeters: simUnitsToMeters(hitDistance),
        kind,
      };
    }
    previousDistance = distance;
    previousInside = inside;
  }

  return createTrackMiss(lengthMeters);
}

function insertNearestCar(nearest, entry, limit) {
  let insertAt = nearest.findIndex((candidate) => (
    entry.distanceSquared < candidate.distanceSquared ||
    (entry.distanceSquared === candidate.distanceSquared && entry.order < candidate.order)
  ));
  if (insertAt < 0) insertAt = nearest.length;
  if (insertAt >= limit) return;
  nearest.splice(insertAt, 0, entry);
  if (nearest.length > limit) nearest.pop();
}

function estimateAnalyticMainTrackHit({ car, track, originState, ray, lengthMeters, includePitLane }) {
  if (includePitLane || isNearPitConnector(track, originState)) return null;
  if (Math.abs(originState.curvature ?? 0) > ANALYTIC_TRACK_RAY_MAX_CURVATURE) return null;

  const lateral = ray.x * originState.normalX + ray.y * originState.normalY;
  if (Math.abs(lateral) < 0.08) return createTrackMiss(lengthMeters);

  const trackHalfWidth = track.width / 2;
  const offset = originState.signedOffset ?? car.signedOffset ?? 0;
  const inside = Math.abs(offset) <= trackHalfWidth;
  const targetEdge = getLocalTrackTransitionTarget({
    inside,
    offsetMeters: offset,
    lateral,
    trackHalfWidthMeters: trackHalfWidth,
  });
  if (targetEdge == null) return createTrackMiss(lengthMeters);

  const distance = (targetEdge - offset) / lateral;
  const maxDistance = metersToSimUnits(lengthMeters);
  if (distance < 0 || distance > maxDistance) return createTrackMiss(lengthMeters);

  return {
    hit: true,
    distanceMeters: simUnitsToMeters(distance),
    kind: inside ? 'exit' : 'entry',
  };
}

function isNearPitConnector(track, state) {
  const pitLane = track.pitLane;
  if (!pitLane?.enabled || !Number.isFinite(state?.distance)) return false;
  const window = metersToSimUnits(PIT_CONNECTOR_RAY_FALLBACK_METERS);
  const entryDistance = pitLane.entry?.trackDistance ?? pitLane.entry?.distanceFromStart;
  const exitDistance = pitLane.exit?.trackDistance ?? pitLane.exit?.distanceFromStart;
  return wrappedTrackDistance(state.distance, entryDistance, track.length) <= window ||
    wrappedTrackDistance(state.distance, exitDistance, track.length) <= window;
}

function wrappedTrackDistance(first, second, totalLength) {
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(totalLength) || totalLength <= 0) {
    return Infinity;
  }
  const delta = Math.abs(first - second);
  return Math.min(delta, totalLength - delta);
}

function estimateLocalTrackHit(car, snapshot, angleDegrees, lengthMeters) {
  const trackHalfWidthMeters = simUnitsToMeters(snapshot.track.width / 2);
  const offsetMeters = simUnitsToMeters(car.signedOffset ?? 0);
  const lateral = Math.sin(degreesToRadians(angleDegrees));
  if (Math.abs(lateral) < 0.08) {
    return createTrackMiss(lengthMeters);
  }

  const inside = Math.abs(offsetMeters) <= trackHalfWidthMeters;
  const targetEdge = getLocalTrackTransitionTarget({ inside, offsetMeters, lateral, trackHalfWidthMeters });
  if (targetEdge == null) return createTrackMiss(lengthMeters);

  const distanceMeters = (targetEdge - offsetMeters) / lateral;
  if (distanceMeters < 0 || distanceMeters > lengthMeters) return createTrackMiss(lengthMeters);

  return {
    hit: true,
    distanceMeters,
    kind: inside ? 'exit' : 'entry',
  };
}

function getLocalTrackTransitionTarget({ inside, offsetMeters, lateral, trackHalfWidthMeters }) {
  if (inside) return lateral > 0 ? trackHalfWidthMeters : -trackHalfWidthMeters;
  if (offsetMeters > trackHalfWidthMeters) return lateral < 0 ? trackHalfWidthMeters : null;
  if (offsetMeters < -trackHalfWidthMeters) return lateral > 0 ? -trackHalfWidthMeters : null;
  return null;
}

function refineTrackTransitionDistance(track, origin, ray, progressHint, lowDistance, highDistance, kind, includePitLane = true) {
  let low = lowDistance;
  let high = highDistance;
  for (let index = 0; index < TRACK_RAY_REFINE_STEPS; index += 1) {
    const middle = (low + high) / 2;
    const state = nearestTrackState(track, pointOnRay(origin, ray, middle), progressHint);
    const inside = isInsideTrackBorder(state, track, includePitLane);
    if (kind === 'entry') {
      if (inside) high = middle;
      else low = middle;
    } else if (inside) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return high;
}

function isInsideTrackBorder(state, track, includePitLane = true) {
  if (includePitLane && state.inPitLane) return true;
  return state.crossTrackError <= track.width / 2;
}

function createTrackMiss(lengthMeters) {
  return {
    hit: false,
    distanceMeters: lengthMeters,
    kind: null,
  };
}

function estimateCarHit(car, snapshot, angleDegrees, lengthMeters, origin = getCarRayOrigin(car)) {
  const ray = getCarRayVector(car, angleDegrees);
  const maxDistance = metersToSimUnits(lengthMeters);
  let closest = null;
  snapshot.cars.forEach((other) => {
    if (other.id === car.id) return;
    if (!carRayBroadphaseHit(origin, ray, maxDistance, other)) return;
    const hitDistance = intersectCarFootprint(origin, ray, other);
    if (hitDistance == null || hitDistance > maxDistance) return;
    const distanceMeters = simUnitsToMeters(hitDistance);
    if (!closest || hitDistance < closest.distanceSimUnits) {
      closest = {
        hit: true,
        distanceSimUnits: hitDistance,
        distanceMeters,
        driverId: other.id,
        relativeSpeedKph: other.speedKph - car.speedKph,
      };
    }
  });
  if (!closest) return { hit: false, distanceMeters: lengthMeters, driverId: null, relativeSpeedKph: 0 };
  const { distanceSimUnits, ...publicHit } = closest;
  return publicHit;
}

function carRayBroadphaseHit(origin, ray, maxDistance, other) {
  const dx = other.x - origin.x;
  const dy = other.y - origin.y;
  const projection = dx * ray.x + dy * ray.y;
  const radius = Math.hypot(VEHICLE_GEOMETRY.bodyLength, VEHICLE_GEOMETRY.bodyWidth) / 2;
  if (projection < -radius || projection > maxDistance + radius) return false;
  const perpendicularSquared = Math.max(0, dx * dx + dy * dy - projection * projection);
  return perpendicularSquared <= radius * radius;
}

export function getCarRayOrigin(car) {
  return {
    x: car.x,
    y: car.y,
  };
}

export function getCarRayVector(car, angleDegrees) {
  const angle = car.heading + degreesToRadians(angleDegrees);
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

function pointOnRay(origin, ray, distance) {
  return {
    x: origin.x + ray.x * distance,
    y: origin.y + ray.y * distance,
  };
}

function intersectCarFootprint(origin, ray, other) {
  const forward = { x: Math.cos(other.heading), y: Math.sin(other.heading) };
  const right = { x: -Math.sin(other.heading), y: Math.cos(other.heading) };
  const delta = { x: origin.x - other.x, y: origin.y - other.y };
  const localOrigin = {
    x: dot(delta, forward),
    y: dot(delta, right),
  };
  const localRay = {
    x: dot(ray, forward),
    y: dot(ray, right),
  };
  const halfLength = VEHICLE_GEOMETRY.bodyLength / 2;
  const halfWidth = VEHICLE_GEOMETRY.bodyWidth / 2;
  return intersectAxisAlignedBoxRay(localOrigin, localRay, halfLength, halfWidth);
}

function intersectAxisAlignedBoxRay(origin, ray, halfLength, halfWidth) {
  let tMin = -Infinity;
  let tMax = Infinity;
  const xRange = intersectSlab(origin.x, ray.x, -halfLength, halfLength);
  const yRange = intersectSlab(origin.y, ray.y, -halfWidth, halfWidth);
  if (!xRange || !yRange) return null;
  tMin = Math.max(tMin, xRange.min, yRange.min);
  tMax = Math.min(tMax, xRange.max, yRange.max);
  if (tMax < 0 || tMin > tMax) return null;
  return Math.max(0, tMin);
}

function intersectSlab(origin, direction, min, max) {
  if (Math.abs(direction) < 1e-9) {
    return origin >= min && origin <= max ? { min: -Infinity, max: Infinity } : null;
  }
  const first = (min - origin) / direction;
  const second = (max - origin) / direction;
  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function normalizeRelativeHeading(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}
