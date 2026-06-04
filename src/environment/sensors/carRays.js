import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import { VEHICLE_GEOMETRY } from '../../simulation/vehicle/vehicleGeometry.js';
import { getCarRayOrigin, getCarRayVector, intersectAxisAlignedBoxRayScalars } from './rayGeometry.js';
import { rayDetectableTargets } from './sensorTargets.js';

export function estimateCarHit(
  car,
  snapshot,
  angleDegrees,
  lengthMeters,
  origin = getCarRayOrigin(car),
  targets = rayDetectableTargets(car, snapshot),
  options = {},
) {
  const ray = options.rayVector ?? getCarRayVector(car, angleDegrees);
  if (options.stats) {
    if (options.rayVector) options.stats.callerVectorCount += 1;
    else options.stats.computedVectorCount += 1;
  }
  const maxDistance = metersToSimUnits(lengthMeters);
  let closestTarget = null;
  let closestDistance = Infinity;
  targets.forEach((other) => {
    if (!carRayBroadphaseHit(origin, ray, maxDistance, other)) return;
    const hitDistance = intersectCarFootprint(origin, ray, other);
    if (hitDistance == null || hitDistance > maxDistance) return;
    if (hitDistance < closestDistance) {
      closestDistance = hitDistance;
      closestTarget = other;
    }
  });
  const resultTarget = options.resultTarget ?? null;
  if (resultTarget && options.stats) options.stats.resultTargetCount += 1;
  if (!closestTarget) return writeCarRayMiss(resultTarget ?? {}, lengthMeters);
  return writeCarRayResult(resultTarget ?? {}, car, closestTarget, closestDistance);
}

export function createCarRayMiss(lengthMeters) {
  return writeCarRayMiss({}, lengthMeters);
}

function writeCarRayMiss(target, lengthMeters) {
  target.hit = false;
  target.distanceMeters = lengthMeters;
  target.driverId = null;
  target.targetId = null;
  target.targetType = null;
  target.relativeSpeedKph = 0;
  return target;
}

function writeCarRayResult(target, car, other, distanceSimUnits) {
  target.hit = true;
  target.distanceMeters = simUnitsToMeters(distanceSimUnits);
  target.driverId = other.id;
  target.targetId = other.id;
  target.targetType = other.entityType;
  target.relativeSpeedKph = other.speedKph - car.speedKph;
  return target;
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
  const forwardX = Math.cos(other.heading);
  const forwardY = Math.sin(other.heading);
  const rightX = -forwardY;
  const rightY = forwardX;
  const deltaX = origin.x - other.x;
  const deltaY = origin.y - other.y;
  const localOriginX = deltaX * forwardX + deltaY * forwardY;
  const localOriginY = deltaX * rightX + deltaY * rightY;
  const localRayX = ray.x * forwardX + ray.y * forwardY;
  const localRayY = ray.x * rightX + ray.y * rightY;
  const halfLength = VEHICLE_GEOMETRY.bodyLength / 2;
  const halfWidth = VEHICLE_GEOMETRY.bodyWidth / 2;
  return intersectAxisAlignedBoxRayScalars(localOriginX, localOriginY, localRayX, localRayY, halfLength, halfWidth);
}
