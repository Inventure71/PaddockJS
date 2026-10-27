import { clamp, normalizeAngle } from '../simMath.js';
import { kphToSimSpeed, metersToSimUnits, simUnitsToMeters } from '../units.js';
import { pointAtInto } from '../track/trackModel.js';
import { VEHICLE_LIMITS, tirePerformanceFactor, arcadeTrackCornerSpeedLimit, arcadeSurfaceGrip } from '../vehicle/vehiclePhysics.js';
import { OVERTAKE_LATERAL_MIN, TRAFFIC_SIDE_GAP } from './driverControlConstants.js';
import { mainTrackCenterOffset } from './trafficScan.js';
import { createDriverInput } from './driverInput.js';
import { angleToPoint } from './driverMath.js';
import { calculateTrackEdgeGuard } from './edgeRecovery.js';
import { calculateActualOverlapPenalty, calculatePlannedTrafficPenalty, planRacingLine } from './racingLinePlan.js';
import { arcadePreviewLookahead, arcadePreviewSpeed, arcadeRacingLookahead, calculateRacingLineOffset, maxLookaheadCurvature } from './arcadeRacePace.js';
import { arcadeRacingSpeedControls, arcadeLongitudinalLimits } from './arcadeRacingEnvelope.js';
import { racingDriverProfile } from './racingDriverProfile.js';

const TARGET_BASE_SCRATCH = { x: 0, y: 0, heading: 0, normalX: 0, normalY: 0, curvature: 0, distance: 0 };
const TARGET_POINT_SCRATCH = { x: 0, y: 0 };

export function decideArcadeRacingControls(car, orderIndex, race) {
  const aggression = car.aggression ?? car.personality?.baseAggression ?? 0.5;
  const profile = racingDriverProfile(car);
  const edgeGuard = calculateTrackEdgeGuard(car, race);
  const previewLookahead = arcadePreviewLookahead(car.speed);
  const previewCurvature = maxLookaheadCurvature(race.track, car.progress, previewLookahead);
  const lookahead = arcadeRacingLookahead(car.speed);
  const targetBase = pointAtInto(race.track, car.progress + lookahead, TARGET_BASE_SCRATCH);
  const curvature = Math.max(car.trackState.curvature, targetBase.curvature, previewCurvature);
  const lanePlan = planRacingLine(car, orderIndex, race);
  const cornerOffsetDamping = clamp(curvature / 0.0012, 0, 0.58);
  const recoveryOffset = edgeGuard.side * edgeGuard.recoveryOffset;
  const racingOffset = calculateRacingLineOffset(car, race, lookahead, curvature, edgeGuard);
  const trafficPressure = lanePlan.attackCommitted || lanePlan.sameLaneAhead || lanePlan.actualLaneAhead || lanePlan.sideRisk ? 1 : 0;
  const racingLineWeight = lanePlan.attackCommitted ? 0.18 : trafficPressure ? 0.52 : 1;
  const cornerOffsetFactor = 1 - cornerOffsetDamping * (lanePlan.attackCommitted ? 0.28 : trafficPressure ? 0.58 : 1);
  const plannedTargetOffset = clamp(
    (lanePlan.offset + racingOffset * racingLineWeight + metersToSimUnits(profile.lineErrorMeters)) * cornerOffsetFactor * (1 - edgeGuard.pressure * 0.8) +
      recoveryOffset * edgeGuard.pressure * 0.8,
    -edgeGuard.recoveryOffset,
    edgeGuard.recoveryOffset,
  );
  // A committed passing lane must unwind with the corner. Moving laterally
  // while the current turn consumes most grip sends a safe speed target off
  // the road. Edge recovery retains priority over holding the current line.
  const cornerHold = trafficPressure && edgeGuard.pressure < 0.2
    ? clamp((car.gripUsage ?? 0) / 0.7, 0, 1) ** 2 : 0;
  const currentOffset = mainTrackCenterOffset(car);
  const targetOffset = clamp(
    currentOffset + (plannedTargetOffset - currentOffset) * (1 - cornerHold),
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
  const cornerTargetKph = arcadePreviewSpeed(car, race.track, previewLookahead, aggression, profile);
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
  // Corner capacity and physical traffic take precedence over maneuvering
  // floors: a stopped leader may require the car to stop until the pass clears.
  const desiredSpeed = Math.min(
    metersToSimUnits(lanePlan.followingSpeed),
    kphToSimSpeed(cornerTargetKph),
    metersToSimUnits(arcadeTrackCornerSpeedLimit(car, pursuitCurve * metersToSimUnits(1), profile.lateralShare * arcadeSurfaceGrip(car))),
    clamp(kphToSimSpeed(desiredSpeedKph), kphToSimSpeed(minimumDesiredSpeedKph), VEHICLE_LIMITS.maxSpeed),
  );
  const pedals = arcadeRacingSpeedControls(car, simUnitsToMeters(desiredSpeed), profile);
  const brakeLimit = arcadeLongitudinalLimits(car).brakeDeceleration * car.mass / car.brakeNewtons;
  let brakeAmount = pedals.brake;
  if (edgeGuard.pressure > 0.46 && car.speed > kphToSimSpeed(48)) {
    brakeAmount = Math.max(brakeAmount, clamp((edgeGuard.pressure - 0.42) * 0.9, 0, brakeLimit));
  }
  const recoveryThrottleScale = edgeGuard.pressure > 0.24
    ? 1 - clamp((Math.abs(headingError) - 0.38) / 0.92, 0, 0.82)
    : 1;

  return createDriverInput()
    .steer(steeringRequest)
    .accelerate(brakeAmount > 0 ? 0 : pedals.throttle * recoveryThrottleScale)
    .brake(brakeAmount)
    .controls();
}

function racingTrafficPenalty(car, lanePlan) {
  const actualLaneLateral = lanePlan.actualLaneAhead
    ? Math.abs(lanePlan.actualLaneAhead.signedOffset - mainTrackCenterOffset(car))
    : Infinity;
  const plannedPassingOverlap = lanePlan.attackCommitted && lanePlan.sameLaneAhead
    ? Math.abs(lanePlan.sameLaneAhead.signedOffset - mainTrackCenterOffset(car)) > OVERTAKE_LATERAL_MIN
    : false;
  return Math.max(
    lanePlan.sameLaneAhead ? calculatePlannedTrafficPenalty(lanePlan.sameLaneAhead, plannedPassingOverlap) : 0,
    lanePlan.actualLaneAhead && actualLaneLateral < OVERTAKE_LATERAL_MIN
      ? calculateActualOverlapPenalty(car, lanePlan.actualLaneAhead)
      : 0,
    lanePlan.sideRisk ? clamp(simUnitsToMeters(TRAFFIC_SIDE_GAP - lanePlan.sideRisk.lateral) * 0.78, 0, 30) : 0,
  );
}
