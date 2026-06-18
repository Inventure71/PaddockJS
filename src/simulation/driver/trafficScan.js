import { metersToSimUnits } from '../units.js';
import { DEFEND_REAR_GAP, TRAFFIC_GAP_AHEAD, TRAFFIC_SIDE_GAP, TRAFFIC_REAR_WINDOW } from './driverControlConstants.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';

const TRAFFIC_REAR_SCAN_WINDOW = metersToSimUnits(39);
const TRAFFIC_FORWARD_SCAN_WINDOW = metersToSimUnits(134);
const TRAFFIC_BESIDE_WINDOW = metersToSimUnits(28);

// Entries are reused across calls: drivers consume the scan synchronously
// within a single control decision, so a module-level pool avoids re-allocating
// the candidate list for every car on every step.
const TRAFFIC_SCRATCH = [];
const TRAFFIC_ENTRY_POOL = [];

export function scanNearbyTraffic(car, race) {
  const traffic = TRAFFIC_SCRATCH;
  traffic.length = 0;
  const cars = race.cars;
  for (let index = 0; index < cars.length; index += 1) {
    const other = cars[index];
    if (other === car) continue;
    const gap = other.raceDistance - car.raceDistance;
    if (gap <= -TRAFFIC_REAR_SCAN_WINDOW || gap >= TRAFFIC_FORWARD_SCAN_WINDOW) continue;
    const entry = TRAFFIC_ENTRY_POOL[traffic.length] ??= { car: null, gap: 0, signedOffset: 0, speed: 0 };
    entry.car = other;
    entry.gap = gap;
    entry.signedOffset = other.trackState?.signedOffset ?? 0;
    entry.speed = other.speed;
    traffic.push(entry);
  }
  return traffic;
}

export function findDefensiveThreat(traffic) {
  let closest = null;

  for (let index = 0; index < traffic.length; index += 1) {
    const entry = traffic[index];
    if (entry.gap >= -VEHICLE_LIMITS.carLength * 1.1 || entry.gap < -DEFEND_REAR_GAP) continue;
    if (!closest || entry.gap > closest.gap) closest = entry;
  }

  return closest;
}

export function findLaneTrafficAhead(traffic, offset, maxDistance) {
  let closest = null;

  for (let index = 0; index < traffic.length; index += 1) {
    const entry = traffic[index];
    if (entry.gap <= 0 || entry.gap > maxDistance) continue;
    if (Math.abs(entry.signedOffset - offset) > TRAFFIC_SIDE_GAP) continue;
    if (!closest || entry.gap < closest.gap) closest = entry;
  }

  return closest;
}

export function findLaneTrafficBeside(traffic, offset) {
  let closest = null;
  let closestLateral = 0;
  let closestRisk = -Infinity;

  for (let index = 0; index < traffic.length; index += 1) {
    const entry = traffic[index];
    const lateral = Math.abs(entry.signedOffset - offset);
    if (Math.abs(entry.gap) > TRAFFIC_BESIDE_WINDOW || lateral > TRAFFIC_SIDE_GAP) continue;
    const risk = (TRAFFIC_BESIDE_WINDOW - Math.abs(entry.gap)) + (TRAFFIC_SIDE_GAP - lateral);
    if (!closest || risk > closestRisk) {
      closest = entry;
      closestLateral = lateral;
      closestRisk = risk;
    }
  }

  return closest ? { ...closest, lateral: closestLateral, risk: closestRisk } : null;
}
