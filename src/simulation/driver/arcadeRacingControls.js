import { clamp, normalizeAngle } from '../simMath.js';
import { kphToSimSpeed, metersToSimUnits, simUnitsToMeters } from '../units.js';
import { pointAtInto } from '../track/trackModel.js';
import { VEHICLE_LIMITS, tirePerformanceFactor } from '../vehicle/vehiclePhysics.js';
import { OVERTAKE_LATERAL_MIN, TRAFFIC_SIDE_GAP } from './driverControlConstants.js';
import { createDriverInput } from './driverInput.js';
import { angleToPoint } from './driverMath.js';
import { calculateTrackEdgeGuard } from './edgeRecovery.js';
import { calculateActualOverlapPenalty, calculatePlannedTrafficPenalty, planRacingLine } from './racingLinePlan.js';
import { arcadePreviewLookahead, arcadePreviewSpeed, calculateRacingLineOffset, maxLookaheadCurvature } from './arcadeRacePace.js';

const TARGET_BASE_SCRATCH = { x: 0, y: 0, heading: 0, normalX: 0, normalY: 0, curvature: 0, distance: 0 };
const TARGET_POINT_SCRATCH = { x: 0, y: 0 };

export function decideArcadeRacingControls(car, orderIndex, race) {
  const aggression = car.aggression ?? car.personality?.baseAggression ?? 0.5;
  const edgeGuard = calculateTrackEdgeGuard(car, race);
  const previewLookahead = arcadePreviewLookahead(car.speed);
  const previewCurvature = maxLookaheadCurvature(race.track, car.progress, previewLookahead);
  const lookahead = metersToSimUnits(clamp(12 + simUnitsToMeters(car.speed) * 0.65, 12, 55));
  const targetBase = pointAtInto(race.track, car.progress + lookahead, TARGET_BASE_SCRATCH);
  const curvature = Math.max(car.trackState.curvature, targetBase.curvature, previewCurvature);
  const lanePlan = planRacingLine(car, orderIndex, race);
  const cornerOffsetDamping = clamp(curvature / 0.0012, 0, 0.58);
  const recoveryOffset = edgeGuard.side * edgeGuard.recoveryOffset;
  const racingOffset = calculateRacingLineOffset(car, race, lookahead, curvature, edgeGuard);
  const trafficPressure = lanePlan.attackCommitted || lanePlan.sameLaneAhead || lanePlan.actualLaneAhead || lanePlan.sideRisk ? 1 : 0;
  const racingLineWeight = lanePlan.attackCommitted ? 0.18 : trafficPressure ? 0.52 : 1;
  const cornerOffsetFactor = 1 - cornerOffsetDamping * (lanePlan.attackCommitted ? 0.28 : trafficPressure ? 0.58 : 1);
  const targetOffset = clamp(
    (lanePlan.offset + racingOffset * racingLineWeight) * cornerOffsetFactor * (1 - edgeGuard.pressure * 0.8) +
      recoveryOffset * edgeGuard.pressure * 0.8,
    -edgeGuard.recoveryOffset,
    edgeGuard.recoveryOffset,
  );
  TARGET_POINT_SCRATCH.x = targetBase.x + targetBase.normalX * targetOffset;
  TARGET_POINT_SCRATCH.y = targetBase.y + targetBase.normalY * targetOffset;
  const angleError = angleToPoint(car, TARGET_POINT_SCRATCH);
  const headingError = normalizeAngle(targetBase.heading - car.heading);
  const steeringLimit = car.trackState.surface === 'kerb' ? VEHICLE_LIMITS.maxSteer * 0.96 : VEHICLE_LIMITS.maxSteer;
  // Invert the arcade bicycle yaw law for the curvature to the chosen lane point.
  // Tire wear scales yaw response in the integrator, so it also scales this inverse.
  const pursuitCurve = 2 * Math.sin(angleError) / Math.max(
    Math.hypot(TARGET_POINT_SCRATCH.x - car.x, TARGET_POINT_SCRATCH.y - car.y),
    metersToSimUnits(1),
  );
  const steeringRequest = clamp(
    Math.atan(VEHICLE_LIMITS.wheelbase * pursuitCurve / tirePerformanceFactor(car.tireEnergy ?? 100)),
    -steeringLimit,
    steeringLimit,
  );
  const cornerTargetKph = arcadePreviewSpeed(car, race.track, previewLookahead, aggression);
  const edgePenalty = edgeGuard.pressure > 0.42
    ? simUnitsToMeters(Math.max(0, car.trackState.crossTrackError - edgeGuard.softLimit)) *
      (5.8 - aggression * 1.1) + edgeGuard.overLimitPressure * 48
    : edgeGuard.overLimitPressure * 48;
  const steeringPenalty = clamp((Math.abs(angleError) - 0.38) * 24, 0, 12);
  const headingPenalty = clamp((Math.abs(headingError) - 0.48) * 42, 0, 24);
  const recoveryAlignmentPenalty = edgeGuard.pressure > 0.2
    ? clamp((Math.abs(headingError) - 0.46) * 64, 0, 38)
    : 0;
  const steeringLoadPenalty = clamp(
    (Math.abs(steeringRequest) / Math.max(steeringLimit, 1e-6) - 0.82) * 42,
    0,
    18,
  ) * clamp(Math.abs(headingError) / 0.48, 0, 1);
  const trafficPenalty = racingTrafficPenalty(car, lanePlan) * (1 - aggression * 0.28);
  const minimumDesiredSpeedKph = edgeGuard.pressure > 0.55 ? 34 : car.trackState.surface === 'kerb' ? 58 : 52;
  const desiredSpeedKph = clamp(
    cornerTargetKph - edgePenalty - steeringPenalty - headingPenalty - recoveryAlignmentPenalty - steeringLoadPenalty - trafficPenalty,
    minimumDesiredSpeedKph,
    330,
  );
  // The maneuvering floor must never override the worn-tire corner limit.
  const desiredSpeed = Math.min(kphToSimSpeed(cornerTargetKph), clamp(
    kphToSimSpeed(desiredSpeedKph),
    kphToSimSpeed(minimumDesiredSpeedKph),
    VEHICLE_LIMITS.maxSpeed,
  ));
  const speedError = desiredSpeed - car.speed;
  const minimumThrottle = edgeGuard.pressure > 0.2 ? 0 : 0.1 + aggression * 0.08;
  const brakeLimit = car.trackState.surface === 'kerb' ? 0.42 : 0.72 - aggression * 0.08;
  let brakeAmount = speedError < -kphToSimSpeed(3)
    ? clamp(Math.abs(speedError) / kphToSimSpeed(28 + aggression * 11), 0, brakeLimit)
    : 0;
  if (edgeGuard.pressure > 0.46 && car.speed > kphToSimSpeed(48)) {
    brakeAmount = Math.max(brakeAmount, clamp((edgeGuard.pressure - 0.42) * 0.9, 0, brakeLimit));
  }
  const recoveryThrottleScale = edgeGuard.pressure > 0.24
    ? 1 - clamp((Math.abs(headingError) - 0.38) / 0.92, 0, 0.82)
    : 1;
  const throttleRequest = speedError > kphToSimSpeed(1)
    ? clamp(speedError / kphToSimSpeed(16), minimumThrottle, 1)
    : 0;

  return createDriverInput()
    .steer(steeringRequest)
    .accelerate(brakeAmount > 0.05 ? 0 : throttleRequest * recoveryThrottleScale)
    .brake(brakeAmount)
    .controls();
}

function racingTrafficPenalty(car, lanePlan) {
  const actualLaneLateral = lanePlan.actualLaneAhead
    ? Math.abs(lanePlan.actualLaneAhead.signedOffset - (car.trackState?.signedOffset ?? 0))
    : Infinity;
  const plannedPassingOverlap = lanePlan.attackCommitted && lanePlan.sameLaneAhead
    ? Math.abs(lanePlan.sameLaneAhead.signedOffset - (car.trackState?.signedOffset ?? 0)) > OVERTAKE_LATERAL_MIN
    : false;
  return Math.max(
    lanePlan.sameLaneAhead ? calculatePlannedTrafficPenalty(lanePlan.sameLaneAhead, plannedPassingOverlap) : 0,
    lanePlan.actualLaneAhead && actualLaneLateral < OVERTAKE_LATERAL_MIN
      ? calculateActualOverlapPenalty(car, lanePlan.actualLaneAhead)
      : 0,
    lanePlan.sideRisk ? clamp(simUnitsToMeters(TRAFFIC_SIDE_GAP - lanePlan.sideRisk.lateral) * 0.78, 0, 30) : 0,
  );
}
