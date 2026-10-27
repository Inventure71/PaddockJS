import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import { normalizeRelativeHeading } from './rayGeometry.js';
import { isSelfCarTarget, nearbyDetectableTargetsForSnapshot } from './sensorTargets.js';

export function buildNearbyCars(car, snapshot, { maxCars = 6, radiusMeters = 150 } = {}, batchContext = null) {
  const limit = Math.max(0, Math.floor(maxCars));
  if (limit === 0) return [];
  const radius = metersToSimUnits(radiusMeters);
  const radiusSquared = radius * radius;
  const forwardX = Math.cos(car.heading);
  const forwardY = Math.sin(car.heading);
  const rightX = -Math.sin(car.heading);
  const rightY = Math.cos(car.heading);
  const nearest = [];

  const targets = batchContext?.nearbyTargets ?? nearbyDetectableTargetsForSnapshot(snapshot);
  for (const other of targets) {
    if (isSelfCarTarget(car, other)) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > radiusSquared) continue;
    const insertAt = nearestInsertIndex(nearest, distanceSquared, other.order);
    if (insertAt >= limit) continue;

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
      sameLap: other.lap != null && other.lap === car.lap,
      entityType: other.entityType,
      distanceSquared,
      order: other.order,
    };
    nearest.splice(insertAt, 0, entry);
    if (nearest.length > limit) nearest.pop();
  }

  return nearest.map(({ distanceSquared, order, ...entry }) => entry);
}

function nearestInsertIndex(nearest, distanceSquared, order) {
  for (let index = 0; index < nearest.length; index += 1) {
    const candidate = nearest[index];
    if (distanceSquared < candidate.distanceSquared ||
      (distanceSquared === candidate.distanceSquared && order < candidate.order)) return index;
  }
  return nearest.length;
}
