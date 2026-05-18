import { metersToSimUnits } from '../units.js';
import { DEFEND_REAR_GAP, TRAFFIC_GAP_AHEAD, TRAFFIC_SIDE_GAP, TRAFFIC_REAR_WINDOW } from './driverControlConstants.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';

export function scanNearbyTraffic(car, race) {
  return race.cars
    .filter((other) => other !== car)
    .map((other) => ({
      car: other,
      gap: other.raceDistance - car.raceDistance,
      signedOffset: other.trackState?.signedOffset ?? 0,
      speed: other.speed,
    }))
    .filter((entry) => entry.gap > -metersToSimUnits(39) && entry.gap < metersToSimUnits(134));
}

export function findDefensiveThreat(traffic) {
  let closest = null;

  traffic.forEach((entry) => {
    if (entry.gap >= -VEHICLE_LIMITS.carLength * 1.1 || entry.gap < -DEFEND_REAR_GAP) return;
    if (!closest || entry.gap > closest.gap) closest = entry;
  });

  return closest;
}

export function findLaneTrafficAhead(traffic, offset, maxDistance) {
  let closest = null;

  traffic.forEach((entry) => {
    if (entry.gap <= 0 || entry.gap > maxDistance) return;
    if (Math.abs(entry.signedOffset - offset) > TRAFFIC_SIDE_GAP) return;
    if (!closest || entry.gap < closest.gap) closest = entry;
  });

  return closest;
}

export function findLaneTrafficBeside(traffic, offset) {
  let closest = null;

  traffic.forEach((entry) => {
    const lateral = Math.abs(entry.signedOffset - offset);
    if (Math.abs(entry.gap) > metersToSimUnits(28) || lateral > TRAFFIC_SIDE_GAP) return;
    const risk = (metersToSimUnits(28) - Math.abs(entry.gap)) + (TRAFFIC_SIDE_GAP - lateral);
    if (!closest || risk > closest.risk) closest = { ...entry, lateral, risk };
  });

  return closest;
}
