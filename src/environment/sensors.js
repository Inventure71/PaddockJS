import { nearestTrackState } from '../simulation/trackModel.js';
import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';
import { VEHICLE_LIMITS } from '../simulation/vehiclePhysics.js';

const TRACK_RAY_STEP_METERS = 1;
const TRACK_RAY_REFINE_STEPS = 12;
export const DEFAULT_RAY_ANGLES_DEGREES = [-135, -60, -20, 0, 20, 60, 135, 180];

export function buildNearbyCars(car, snapshot, { maxCars = 6, radiusMeters = 150 } = {}) {
  return snapshot.cars
    .filter((other) => other.id !== car.id)
    .map((other) => {
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const distanceMeters = simUnitsToMeters(Math.hypot(dx, dy));
      const forward = Math.cos(car.heading) * dx + Math.sin(car.heading) * dy;
      const right = -Math.sin(car.heading) * dx + Math.cos(car.heading) * dy;
      return {
        id: other.id,
        relativeForwardMeters: simUnitsToMeters(forward),
        relativeRightMeters: simUnitsToMeters(right),
        relativeDistanceMeters: distanceMeters,
        relativeSpeedKph: other.speedKph - car.speedKph,
        relativeHeadingRadians: normalizeRelativeHeading(other.heading - car.heading),
        ahead: forward > 0,
        sameLap: other.lap === car.lap,
      };
    })
    .filter((entry) => entry.relativeDistanceMeters <= radiusMeters)
    .sort((a, b) => a.relativeDistanceMeters - b.relativeDistanceMeters)
    .slice(0, maxCars);
}

export function buildRaySensors(car, snapshot, rayOptions = {}) {
  const angles = rayOptions.anglesDegrees ?? DEFAULT_RAY_ANGLES_DEGREES;
  const lengthMeters = rayOptions.lengthMeters ?? 120;

  return angles.map((angleDegrees) => ({
    angleDegrees,
    angleRadians: degreesToRadians(angleDegrees),
    lengthMeters,
    track: rayOptions.detectTrack === false
      ? { hit: false, distanceMeters: lengthMeters, surface: car.surface ?? 'track' }
      : estimateTrackHit(car, snapshot, angleDegrees, lengthMeters),
    car: rayOptions.detectCars === false
      ? { hit: false, distanceMeters: lengthMeters, driverId: null, relativeSpeedKph: 0 }
      : estimateCarHit(car, snapshot, angleDegrees, lengthMeters),
  }));
}

function estimateTrackHit(car, snapshot, angleDegrees, lengthMeters) {
  if (!Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return estimateLocalTrackHit(car, snapshot, angleDegrees, lengthMeters);
  }

  const origin = getCarRayOrigin(car);
  const ray = getCarRayVector(car, angleDegrees);
  const maxDistance = metersToSimUnits(lengthMeters);
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  let previousDistance = 0;
  let previousSurface = car.surface ?? 'track';

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const state = nearestTrackState(snapshot.track, pointOnRay(origin, ray, distance), car.progress);
    previousSurface = state.surface;
    if (state.crossTrackError > snapshot.track.width / 2) {
      const hitDistance = refineTrackEdgeDistance(snapshot.track, origin, ray, car.progress, previousDistance, distance);
      return {
        hit: true,
        distanceMeters: simUnitsToMeters(hitDistance),
        surface: state.surface,
      };
    }
    previousDistance = distance;
  }

  return {
    hit: false,
    distanceMeters: lengthMeters,
    surface: previousSurface,
  };
}

function estimateLocalTrackHit(car, snapshot, angleDegrees, lengthMeters) {
  const trackHalfWidthMeters = simUnitsToMeters(snapshot.track.width / 2);
  const offsetMeters = simUnitsToMeters(car.signedOffset ?? 0);
  const lateral = Math.sin(degreesToRadians(angleDegrees));
  if (Math.abs(lateral) < 0.08) {
    return { hit: false, distanceMeters: lengthMeters, surface: car.surface ?? 'track' };
  }
  const targetEdge = lateral > 0 ? trackHalfWidthMeters - offsetMeters : trackHalfWidthMeters + offsetMeters;
  return {
    hit: true,
    distanceMeters: Math.min(lengthMeters, Math.abs(targetEdge / lateral)),
    surface: car.surface ?? 'track',
  };
}

function refineTrackEdgeDistance(track, origin, ray, progressHint, lowDistance, highDistance) {
  let low = lowDistance;
  let high = highDistance;
  for (let index = 0; index < TRACK_RAY_REFINE_STEPS; index += 1) {
    const middle = (low + high) / 2;
    const state = nearestTrackState(track, pointOnRay(origin, ray, middle), progressHint);
    if (state.crossTrackError > track.width / 2) high = middle;
    else low = middle;
  }
  return high;
}

function estimateCarHit(car, snapshot, angleDegrees, lengthMeters) {
  const origin = getCarRayOrigin(car);
  const ray = getCarRayVector(car, angleDegrees);
  const maxDistance = metersToSimUnits(lengthMeters);
  let closest = null;
  snapshot.cars.forEach((other) => {
    if (other.id === car.id) return;
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
  const halfLength = VEHICLE_LIMITS.carLength / 2;
  const halfWidth = VEHICLE_LIMITS.carWidth / 2;
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
