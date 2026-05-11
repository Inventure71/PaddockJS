import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import { VEHICLE_GEOMETRY } from '../../simulation/vehicle/vehicleGeometry.js';
import { dot, getCarRayOrigin, getCarRayVector, intersectAxisAlignedBoxRay } from './rayGeometry.js';
import { rayDetectableTargets } from './sensorTargets.js';

export function estimateCarHit(car, snapshot, angleDegrees, lengthMeters, origin = getCarRayOrigin(car)) {
  const ray = getCarRayVector(car, angleDegrees);
  const maxDistance = metersToSimUnits(lengthMeters);
  let closest = null;
  rayDetectableTargets(car, snapshot).forEach((other) => {
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
        targetId: other.id,
        targetType: other.entityType,
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
