import { clamp, normalizeAngle } from '../simMath.js';
import { kphToSimSpeed, metersToSimUnits, simUnitsToMeters } from '../units.js';
import { offsetTrackPoint, pointAt } from '../track/trackModel.js';
import { SAFETY_CAR_LOOKAHEAD_MAX, SAFETY_CAR_LOOKAHEAD_MIN } from './driverControlConstants.js';
import { angleToPoint } from './driverMath.js';
import { createDriverInput } from './driverInput.js';

export function decideSafetyCarControls(car, orderIndex, race) {
  const queueSlot = race.safetyCar.progress - race.rules.safetyCarLeadDistance - orderIndex * race.rules.safetyCarGap;
  const lookahead = clamp(car.speed * 0.55 + metersToSimUnits(20), SAFETY_CAR_LOOKAHEAD_MIN, SAFETY_CAR_LOOKAHEAD_MAX);
  const targetBase = pointAt(race.track, car.progress + lookahead);
  const target = offsetTrackPoint(targetBase, 0);
  const slotError = queueSlot - car.raceDistance;
  const headingError = normalizeAngle(targetBase.heading - car.heading);
  const lateralError = car.trackState?.signedOffset ?? 0;
  const centerlineCorrection = -Math.atan2(
    lateralError * 1.25,
    Math.max(car.speed, kphToSimSpeed(35)),
  );
  const cornerRadiusMeters = simUnitsToMeters(1 / Math.max(Math.abs(targetBase.curvature), 1e-7));
  const cornerSpeed = kphToSimSpeed(clamp(Math.sqrt(4.2 * cornerRadiusMeters) * 3.6, 45, 158));
  const edgePenalty = clamp(simUnitsToMeters(Math.abs(lateralError)) - simUnitsToMeters(race.track.width / 2) * 0.68, 0, 3) * kphToSimSpeed(18);
  const desiredSpeed = clamp(
    race.rules.safetyCarSpeed + slotError * 0.24 - edgePenalty,
    kphToSimSpeed(22),
    Math.min(race.rules.safetyCarSpeed + kphToSimSpeed(32), cornerSpeed),
  );
  const speedError = desiredSpeed - car.speed;

  return createDriverInput()
    .steer(angleToPoint(car, target) * 1.18 + headingError * 0.32 + centerlineCorrection)
    .accelerate(speedError > kphToSimSpeed(1) ? clamp(speedError / kphToSimSpeed(16), 0, 0.5) : 0)
    .brake(speedError < -kphToSimSpeed(0.5) ? clamp(Math.abs(speedError) / kphToSimSpeed(14), 0, 1) : 0)
    .controls();
}
