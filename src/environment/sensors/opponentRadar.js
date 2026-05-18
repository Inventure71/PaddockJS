import { kphToSimSpeed, simSpeedToMetersPerSecond, simUnitsToMeters } from '../../simulation/units.js';
import { VEHICLE_GEOMETRY } from '../../simulation/vehicle/vehicleGeometry.js';

export function enrichOpponentRadar(car, nearbyCars, snapshot) {
  const targetsById = new Map([
    ...(snapshot.cars ?? []).map((entry) => [entry.id, entry]),
    ...(snapshot.replayGhosts ?? []).map((entry) => [entry.id, entry]),
  ]);

  return nearbyCars.map((nearby) => {
    const target = targetsById.get(nearby.id);
    const derived = target ? deriveRadarFields(car, target, nearby) : fallbackRadarFields(nearby);
    return {
      ...nearby,
      ...derived,
    };
  });
}

function deriveRadarFields(car, target, nearby) {
  const dx = (target.x ?? 0) - (car.x ?? 0);
  const dy = (target.y ?? 0) - (car.y ?? 0);
  const distance = Math.max(1e-9, Math.hypot(dx, dy));
  const selfVelocity = velocity(car);
  const targetVelocity = velocity(target);
  const relativeVelocity = {
    x: targetVelocity.x - selfVelocity.x,
    y: targetVelocity.y - selfVelocity.y,
  };
  const closingRate = -((relativeVelocity.x * dx + relativeVelocity.y * dy) / distance);
  const closingRateMetersPerSecond = simSpeedToMetersPerSecond(closingRate);
  const distanceMeters = nearby.relativeDistanceMeters ?? simUnitsToMeters(distance);
  const longitudinalOverlap = Math.abs(nearby.relativeForwardMeters ?? 0) <= simUnitsToMeters(VEHICLE_GEOMETRY.bodyLength);
  const lateralOverlap = Math.abs(nearby.relativeRightMeters ?? 0) <= simUnitsToMeters(VEHICLE_GEOMETRY.bodyWidth);
  const sideOverlap = longitudinalOverlap && lateralOverlap;

  return {
    behind: !nearby.ahead,
    closingRateMetersPerSecond,
    timeToContactSeconds: closingRateMetersPerSecond > 0
      ? distanceMeters / closingRateMetersPerSecond
      : null,
    leftOverlap: sideOverlap && (nearby.relativeRightMeters ?? 0) < 0,
    rightOverlap: sideOverlap && (nearby.relativeRightMeters ?? 0) > 0,
  };
}

function fallbackRadarFields(nearby) {
  return {
    behind: !nearby.ahead,
    closingRateMetersPerSecond: 0,
    timeToContactSeconds: null,
    leftOverlap: false,
    rightOverlap: false,
  };
}

function velocity(car) {
  const speed = Number.isFinite(car.speed) ? car.speed : kphToSimSpeed(car.speedKph ?? 0);
  const heading = car.heading ?? car.headingRadians ?? 0;
  return {
    x: Math.cos(heading) * speed,
    y: Math.sin(heading) * speed,
  };
}
