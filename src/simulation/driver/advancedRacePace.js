import { clamp } from '../simMath.js';
import { metersToSimUnits, simUnitsToMeters, TOP_SPEED_SIM_UNITS_PER_SECOND } from '../units.js';
import { pointAt } from '../track/trackModel.js';
import { signedLateralOffsetToPoint } from '../track/trackMath.js';
import { VEHICLE_LIMITS, tirePerformanceFactor } from '../vehicle/vehiclePhysics.js';
import { advancedDriveForce, advancedDragFactor } from '../vehicle/advancedVehicleModel.js';
import { advancedLateralAccelerationLimit, advancedRollingResistanceForce } from '../vehicle/advancedTireForces.js';
import { advancedLongitudinalLimits } from './advancedPathControls.js';
import { canCollide } from '../participants/participantInteractions.js';
import { TRAFFIC_GAP_AHEAD } from './driverControlConstants.js';

const MAX_SPEED = simUnitsToMeters(TOP_SPEED_SIM_UNITS_PER_SECOND);
export const ADVANCED_RACING_GRIP_SHARE = 0.6;
const SAMPLE_SPACING = 12; // meters
const SPEED_RESPONSE_SECONDS = 0.0625;

export function advancedCornerSpeed(car, curvature, tireFactor) {
  const curve = Math.abs(curvature);
  if (curve < 1e-6) return MAX_SPEED;
  const high = MAX_SPEED ** 2;
  const highValue = ADVANCED_RACING_GRIP_SHARE * advancedLateralAccelerationLimit(car, MAX_SPEED, tireFactor) - curve * high;
  if (highValue >= 0) return MAX_SPEED;
  let low = 0;
  let lowValue = ADVANCED_RACING_GRIP_SHARE * advancedLateralAccelerationLimit(car, 0, tireFactor);
  let speed = 0;
  // Static load is affine in speed squared and contact capacity is concave.
  // A chord between opposite signs therefore gives a conservative lower root.
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const next = low + (high - low) * lowValue / (lowValue - highValue);
    const nextSpeed = Math.sqrt(next);
    if (nextSpeed - speed < 0.01) return nextSpeed;
    low = next;
    speed = nextSpeed;
    lowValue = ADVANCED_RACING_GRIP_SHARE * advancedLateralAccelerationLimit(car, speed, tireFactor) - curve * low;
  }
  return speed;
}

export function advancedRaceTargetSpeed(car, track, pathCurvature) {
  const speed = simUnitsToMeters(car.speed);
  const tireFactor = tirePerformanceFactor(car.tireEnergy ?? 100);
  const horizon = Math.max(80, speed * 3);
  let targetSpeed = MAX_SPEED;
  // Work backward from future corners. Reserve lateral grip when estimating
  // braking; the lower future speed also gives a conservative aero estimate.
  // Quarter-second anticipation covers actuator/trajectory response delay.
  for (let distance = Math.ceil(horizon / SAMPLE_SPACING) * SAMPLE_SPACING; distance >= 0; distance -= SAMPLE_SPACING) {
    const sample = pointAt(track, car.progress + metersToSimUnits(distance + speed * 0.25));
    const curve = Math.abs(sample.curvature) * metersToSimUnits(1);
    const capacity = advancedLateralAccelerationLimit(car, targetSpeed, tireFactor);
    const lateralShare = Math.min(0.9, targetSpeed ** 2 * curve / capacity);
    const deceleration = capacity * Math.sqrt(1 - lateralShare ** 2) * 0.55;
    targetSpeed = Math.min(advancedCornerSpeed(car, curve, tireFactor), Math.sqrt(targetSpeed ** 2 + 2 * deceleration * SAMPLE_SPACING));
  }
  // Passing and path correction may demand a tighter turn than the centerline.
  return Math.min(targetSpeed, advancedCornerSpeed(car, pathCurvature, tireFactor));
}

export function advancedRacingSpeedControls(car, targetSpeed) {
  const { speed, throttleLimit, brakeLimit } = advancedLongitudinalLimits(car);
  const resistance = targetSpeed > 0
    ? advancedRollingResistanceForce(car, speed) + advancedDragFactor(car) * speed ** 2 : 0;
  // Request net acceleration, then add the force needed merely to hold speed.
  // Both pedals share one signed demand so a slowdown cannot request throttle
  // and braking together. Tire/engine limits remain those of the actual car.
  const requestedForce = car.mass * (targetSpeed - speed) / SPEED_RESPONSE_SECONDS + resistance;
  return {
    throttle: clamp(requestedForce / advancedDriveForce(car, speed), 0, Math.min(1, throttleLimit)),
    brake: clamp(-requestedForce / car.brakeNewtons, 0, Math.min(0.85, brakeLimit)),
  };
}

export function advancedFollowingSpeed(car, cars) {
  // Surface signedOffset belongs to the outermost wheel patch. Project the
  // chassis centers using the retained centerline point/normal instead.
  const centerOffset = mainTrackCenterOffset(car);
  let leader = null;
  let gap = TRAFFIC_GAP_AHEAD;
  for (const other of cars) {
    if (other === car || !canCollide(car, other)) continue;
    const distance = other.raceDistance - car.raceDistance;
    if (distance <= 0 || distance > gap) continue;
    const lateral = Math.abs(mainTrackCenterOffset(other) - centerOffset);
    if (lateral >= VEHICLE_LIMITS.carWidth + metersToSimUnits(0.4)) continue;
    leader = other;
    gap = distance;
  }
  if (!leader) return MAX_SPEED;
  const speed = simUnitsToMeters(car.speed);
  const followingGap = simUnitsToMeters(VEHICLE_LIMITS.carLength) + 2 + speed * 0.35;
  return Math.max(0, simUnitsToMeters(leader.speed) + (simUnitsToMeters(gap) - followingGap) * 1.2);
}

function mainTrackCenterOffset(car) {
  // Pit overrides use a pit-local point/normal but retain the main-track
  // center offset. Lane comparisons must stay in the same track corridor.
  return car.trackState.mainTrackSignedOffset ?? signedLateralOffsetToPoint(car.trackState, car);
}
