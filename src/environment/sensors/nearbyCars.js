import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import { normalizeRelativeHeading } from './rayGeometry.js';
import { nearbyDetectableTargets } from './sensorTargets.js';

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

  nearbyDetectableTargets(car, snapshot).forEach((other) => {
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
      sameLap: other.lap != null && other.lap === car.lap,
      entityType: other.entityType,
      distanceSquared,
      order: other.order,
    };
    insertNearestCar(nearest, entry, limit);
  });

  return nearest.map(({ distanceSquared, order, ...entry }) => entry);
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
