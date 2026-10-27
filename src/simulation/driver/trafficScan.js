import { metersToSimUnits, simUnitsToMeters, TOP_SPEED_SIM_UNITS_PER_SECOND } from '../units.js';
import { DEFEND_REAR_GAP, TRAFFIC_SIDE_GAP, TRAFFIC_GAP_AHEAD } from './driverControlConstants.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';
import { canCollide } from '../participants/participantInteractions.js';
import { signedLateralOffsetToPoint } from '../track/trackMath.js';

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
    if (other === car || !canCollide(car, other)) continue;
    const gap = physicalTrafficGap(car, other, race.track?.length);
    if (gap <= -TRAFFIC_REAR_SCAN_WINDOW || gap >= TRAFFIC_FORWARD_SCAN_WINDOW) continue;
    const entry = TRAFFIC_ENTRY_POOL[traffic.length] ??= { car: null, gap: 0, signedOffset: 0, speed: 0 };
    entry.car = other;
    entry.gap = gap;
    entry.signedOffset = mainTrackCenterOffset(other);
    entry.speed = other.speed;
    traffic.push(entry);
  }
  return traffic;
}

export function findDefensiveThreat(traffic, corridorLimit = Infinity, car = null) {
  let closest = null;

  for (let index = 0; index < traffic.length; index += 1) {
    const entry = traffic[index];
    if (Math.abs(entry.signedOffset) > corridorLimit) continue;
    // A physically rearward car with greater race distance is lapping us.
    // Yield ordinary road space instead of treating it as a position threat.
    if (car && entry.car.raceDistance > car.raceDistance) continue;
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

// Race classification distance can differ by whole laps while the cars occupy
// the same piece of road. Keep traffic in the local, signed circuit frame.
export function physicalTrafficGap(car, other, trackLength) {
  if (!(trackLength > 0)) return other.raceDistance - car.raceDistance;
  let gap = ((other.progress ?? other.raceDistance) - (car.progress ?? car.raceDistance)) % trackLength;
  if (gap > trackLength / 2) gap -= trackLength;
  else if (gap < -trackLength / 2) gap += trackLength;
  return gap;
}

export function mainTrackCenterOffset(car) {
  // Pit surfaces retain the chassis offset in the main-track frame. Ordinary
  // signedOffset describes an outer wheel, so project the center instead.
  const state = car.trackState;
  if (state?.mainTrackSignedOffset != null) return state.mainTrackSignedOffset;
  const projected = state ? signedLateralOffsetToPoint(state, car) : NaN;
  return Number.isFinite(projected) ? projected : state?.signedOffset ?? 0;
}

export function followingSpeedLimit(car, cars, trackLength) {
  const centerOffset = mainTrackCenterOffset(car);
  let leader = null;
  let gap = TRAFFIC_GAP_AHEAD;
  for (let index = 0; index < cars.length; index += 1) {
    const other = cars[index];
    if (other === car || !canCollide(car, other)) continue;
    const distance = physicalTrafficGap(car, other, trackLength);
    if (distance <= 0 || distance > gap) continue;
    const lateral = Math.abs(mainTrackCenterOffset(other) - centerOffset);
    if (lateral >= VEHICLE_LIMITS.carWidth + metersToSimUnits(0.4)) continue;
    leader = other;
    gap = distance;
  }
  return followingTargetSpeed(car, leader, gap);
}

// The lane planner already has a filtered scan. Reuse it for pacing instead
// of rescanning the entire field for every driver decision.
export function followingSpeedFromTraffic(car, traffic) {
  const centerOffset = mainTrackCenterOffset(car);
  let leader = null;
  let gap = TRAFFIC_GAP_AHEAD;
  for (let index = 0; index < traffic.length; index += 1) {
    const entry = traffic[index];
    if (entry.gap <= 0 || entry.gap > gap) continue;
    if (Math.abs(entry.signedOffset - centerOffset) >= VEHICLE_LIMITS.carWidth + metersToSimUnits(0.4)) continue;
    leader = entry.car;
    gap = entry.gap;
  }
  return followingTargetSpeed(car, leader, gap);
}

function followingTargetSpeed(car, leader, gap) {
  if (!leader) return simUnitsToMeters(TOP_SPEED_SIM_UNITS_PER_SECOND);
  const speed = simUnitsToMeters(car.speed);
  const followingGap = simUnitsToMeters(VEHICLE_LIMITS.carLength) + 2 + speed * 0.35;
  return Math.max(0, simUnitsToMeters(leader.speed) + (simUnitsToMeters(gap) - followingGap) * 1.2);
}

// Lane intentions and corner offsets compose differently in each mode. Return
// the available lateral corridor so the final commanded path stays clear of
// cars alongside, rather than checking only an intermediate lane intention.
const LANE_MOVEMENT_BOUNDS = { minimum: -Infinity, maximum: Infinity };
export function laneMovementBounds(traffic, currentOffset) {
  const bounds = LANE_MOVEMENT_BOUNDS;
  bounds.minimum = -Infinity;
  bounds.maximum = Infinity;
  for (let index = 0; index < traffic.length; index += 1) {
    const entry = traffic[index];
    if (Math.abs(entry.gap) > VEHICLE_LIMITS.carLength) continue;
    const neighbor = entry.signedOffset - currentOffset;
    if (neighbor > 0) bounds.maximum = Math.min(bounds.maximum, Math.max(currentOffset, entry.signedOffset - VEHICLE_LIMITS.carWidth));
    else if (neighbor < 0) bounds.minimum = Math.max(bounds.minimum, Math.min(currentOffset, entry.signedOffset + VEHICLE_LIMITS.carWidth));
  }
  return bounds;
}
