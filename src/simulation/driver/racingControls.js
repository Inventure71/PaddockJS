import { clamp, normalizeAngle } from '../simMath.js';
import { kphToSimSpeed, metersToSimUnits, simUnitsToMeters } from '../units.js';
import { offsetTrackPoint, pointAt } from '../track/trackModel.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';
import { BRAKING_LOOKAHEAD_MAX_DISTANCE, CURVATURE_LOOKAHEAD_SAMPLES, EDGE_RECOVERY_MIN_LOOKAHEAD, LOOKAHEAD_BASE_DISTANCE, LOOKAHEAD_MAX_DISTANCE, OVERTAKE_LATERAL_MIN, PREVIEW_CURVATURE_CAP, TRAFFIC_GAP_AHEAD, TRAFFIC_SIDE_GAP } from './driverControlConstants.js';
import { createDriverInput } from './driverInput.js';
import { angleToPoint } from './driverMath.js';
import { calculateTrackEdgeGuard } from './edgeRecovery.js';
import { calculateActualOverlapPenalty, calculatePlannedTrafficPenalty, planRacingLine } from './racingLinePlan.js';

export function decideRacingControls(car, orderIndex, race) {
  const aggression = car.aggression ?? car.personality?.baseAggression ?? 0.5;
  const simulatorMode = race.physicsMode === 'simulator';
  const edgeGuard = calculateTrackEdgeGuard(car, race);
  const gripUsage = Number.isFinite(car.gripUsage) ? car.gripUsage : 0;
  const slipAngle = Math.abs(car.slipAngleRadians ?? 0);
  const baseLookahead = clamp(
    car.speed * (simulatorMode ? 2.18 - aggression * 0.08 : 1.62 - aggression * 0.12) +
      LOOKAHEAD_BASE_DISTANCE -
      edgeGuard.pressure * metersToSimUnits(simulatorMode ? 28 : 18),
    EDGE_RECOVERY_MIN_LOOKAHEAD,
    LOOKAHEAD_MAX_DISTANCE,
  );
  const previewLookahead = clamp(
    car.speed * (simulatorMode ? 4.8 : 3.15) + LOOKAHEAD_BASE_DISTANCE,
    baseLookahead,
    BRAKING_LOOKAHEAD_MAX_DISTANCE,
  );
  const previewCurvature = maxLookaheadCurvature(race.track, car.progress, previewLookahead);
  const cornerPressure = clamp(previewCurvature / 0.001, 0, 1);
  const lookahead = clamp(
    baseLookahead * (1 - cornerPressure * 0.46),
    EDGE_RECOVERY_MIN_LOOKAHEAD,
    LOOKAHEAD_MAX_DISTANCE,
  );
  const targetBase = pointAt(race.track, car.progress + lookahead);
  const curvature = Math.max(
    car.trackState.curvature,
    targetBase.curvature,
    previewCurvature,
  );
  const lanePlan = planRacingLine(car, orderIndex, race);
  const cornerOffsetDamping = clamp(curvature / 0.0012, 0, 0.58);
  const recoveryOffset = edgeGuard.side * edgeGuard.recoveryOffset;
  const racingOffset = calculateRacingLineOffset(car, race, lookahead, curvature, edgeGuard);
  const trafficPressure = lanePlan.attackCommitted || lanePlan.sameLaneAhead || lanePlan.actualLaneAhead || lanePlan.sideRisk ? 1 : 0;
  const racingLineWeight = lanePlan.attackCommitted ? 0.18 : trafficPressure ? 0.52 : 1;
  const cornerOffsetFactor = 1 - cornerOffsetDamping * (lanePlan.attackCommitted ? 0.28 : trafficPressure ? 0.58 : 1);
  const edgeLineDamping = simulatorMode ? 1.35 : 0.8;
  const edgeRecoveryWeight = simulatorMode ? 1.25 : 0.8;
  const targetOffset = clamp(
    (lanePlan.offset + racingOffset * racingLineWeight) * cornerOffsetFactor * (1 - edgeGuard.pressure * edgeLineDamping) +
      recoveryOffset * edgeGuard.pressure * edgeRecoveryWeight,
    -edgeGuard.recoveryOffset,
    edgeGuard.recoveryOffset,
  );
  const target = offsetTrackPoint(targetBase, targetOffset);
  const angleError = angleToPoint(car, target);
  const headingError = normalizeAngle(targetBase.heading - car.heading);
  const lateralError = car.trackState?.signedOffset ?? 0;
  const outwardDriftAngle = simulatorMode &&
    Math.sign(lateralError) !== 0 &&
    Math.sign(normalizeAngle(car.heading - (car.trackState?.heading ?? targetBase.heading))) === Math.sign(lateralError)
    ? Math.abs(normalizeAngle(car.heading - (car.trackState?.heading ?? targetBase.heading)))
    : 0;
  const cornerCommitment = clamp(Math.abs(headingError) / 0.9, 0, 0.72);
  const lateralCorrection = -Math.atan2(
    lateralError * (0.85 + edgeGuard.pressure * 0.5),
    Math.max(car.speed, kphToSimSpeed(35)),
  ) * (1 - cornerCommitment * (simulatorMode ? 0.78 : 0.62));
  const headingFeedForward = clamp(
    headingError * (
      simulatorMode
        ? 0.24 + car.racecraft * 0.11 + edgeGuard.pressure * 0.08
        : 0.34 + car.racecraft * 0.18 + edgeGuard.pressure * 0.12
    ),
    simulatorMode ? -0.3 : -0.42,
    simulatorMode ? 0.3 : 0.42,
  );
  let pathSteer = angleError * (
    simulatorMode
      ? 0.54 + car.racecraft * 0.08 + edgeGuard.pressure * 0.24
      : 0.72 + car.racecraft * 0.12 + edgeGuard.pressure * 0.42
  ) + headingFeedForward;
  if (edgeGuard.side !== 0 && Math.sign(pathSteer) === edgeGuard.side) {
    pathSteer *= 1 - edgeGuard.pressure * 0.85;
  }
  const edgeRecoverySteer = -edgeGuard.side * clamp(
    (edgeGuard.pressure - (simulatorMode ? 0.08 : 0.22)) * (simulatorMode ? 2.7 : 1.18) +
      edgeGuard.overLimitPressure * (simulatorMode ? 0.9 : 0.55) +
      (simulatorMode ? outwardDriftAngle * clamp(Math.abs(lateralError) / (race.track.width * 0.26), 0, 1) * 1.8 : 0),
    0,
    simulatorMode ? 0.9 : 0.52,
  );
  const speedRatio = clamp(car.speed / VEHICLE_LIMITS.maxSpeed, 0, 1);
  const simulatorSteeringLimit = VEHICLE_LIMITS.maxSteer *
    clamp(1 - speedRatio * 0.48 - gripUsage * 0.08, 0.34, 1);
  const steeringLimit = simulatorMode
    ? (car.trackState.surface === 'kerb' ? simulatorSteeringLimit * 0.82 : simulatorSteeringLimit)
    : car.trackState.surface === 'kerb'
      ? VEHICLE_LIMITS.maxSteer * 0.96
      : VEHICLE_LIMITS.maxSteer;
  const steeringRequest = clamp(pathSteer + lateralCorrection + edgeRecoverySteer, -steeringLimit, steeringLimit);
  const cornerRadiusMeters = simUnitsToMeters(1 / Math.max(curvature, 1e-7));
  const lateralGripBudget = simulatorMode
    ? 12.4 + car.racecraft * 2.2 + (car.tireEnergy ?? 100) * 0.01 + aggression * 1.2
    : 14.8 + car.racecraft * 3.4 + (car.tireEnergy ?? 100) * 0.011 + aggression * 1.8;
  const cornerTargetKph = clamp(
    Math.sqrt(lateralGripBudget * cornerRadiusMeters) * 3.6 *
      (simulatorMode ? 0.99 + aggression * 0.05 : 1.1 + aggression * 0.08) +
      (car.pace - 1) * (simulatorMode ? 16 : 20) + aggression * (simulatorMode ? 7 : 10),
    simulatorMode ? 78 : 96,
    simulatorMode ? 318 : 318,
  );
  const edgePenalty = edgeGuard.pressure > 0.42
    ? simUnitsToMeters(Math.max(0, car.trackState.crossTrackError - edgeGuard.softLimit)) *
      ((simulatorMode ? 8.8 : 5.8) - aggression * 1.1) +
      edgeGuard.overLimitPressure * (simulatorMode ? 82 : 48)
    : edgeGuard.overLimitPressure * (simulatorMode ? 82 : 48) +
      (simulatorMode ? edgeGuard.pressure * 24 : 0);
  const steeringPenalty = clamp((Math.abs(angleError) - (simulatorMode ? 0.34 : 0.38)) * (simulatorMode ? 30 : 24), 0, simulatorMode ? 18 : 12);
  const headingPenalty = clamp((Math.abs(headingError) - (simulatorMode ? 0.42 : 0.48)) * (simulatorMode ? 44 : 42), 0, simulatorMode ? 30 : 24);
  const recoveryAlignmentPenalty = edgeGuard.pressure > 0.2
    ? clamp((Math.abs(headingError) - (simulatorMode ? 0.36 : 0.46)) * (simulatorMode ? 70 : 64), 0, simulatorMode ? 42 : 38)
    : 0;
  const steeringLoadPenalty = clamp(
    (Math.abs(steeringRequest) / Math.max(steeringLimit, 1e-6) - (simulatorMode ? 0.7 : 0.82)) * (simulatorMode ? 42 : 42),
    0,
    simulatorMode ? 24 : 18,
  ) * clamp(Math.abs(headingError) / (simulatorMode ? 0.34 : 0.48), 0, 1);
  const simulatorLoadPenalty = simulatorMode
    ? clamp((gripUsage - 0.68) * 60, 0, 28) +
      clamp(slipAngle * 80, 0, 24) +
      cornerPressure * 10 +
      clamp(outwardDriftAngle * 310, 0, 54)
    : 0;
  const actualLaneLateral = lanePlan.actualLaneAhead
    ? Math.abs(lanePlan.actualLaneAhead.signedOffset - (car.trackState?.signedOffset ?? 0))
    : Infinity;
  const plannedPassingOverlap = lanePlan.attackCommitted && lanePlan.sameLaneAhead
    ? Math.abs(lanePlan.sameLaneAhead.signedOffset - (car.trackState?.signedOffset ?? 0)) > OVERTAKE_LATERAL_MIN
    : false;
  const trafficPenalty = Math.max(
    lanePlan.sameLaneAhead
      ? calculatePlannedTrafficPenalty(lanePlan.sameLaneAhead, plannedPassingOverlap)
      : 0,
    lanePlan.actualLaneAhead && actualLaneLateral < OVERTAKE_LATERAL_MIN
      ? calculateActualOverlapPenalty(car, lanePlan.actualLaneAhead)
      : 0,
    lanePlan.sideRisk ? clamp(simUnitsToMeters(TRAFFIC_SIDE_GAP - lanePlan.sideRisk.lateral) * 0.42, 0, 16) : 0,
  ) * (1 - aggression * 0.28);
  const minimumDesiredSpeedKph = edgeGuard.pressure > 0.55
    ? simulatorMode ? 42 : 34
    : car.trackState.surface === 'kerb' ? simulatorMode ? 54 : 58 : simulatorMode ? 48 : 52;
  const desiredSpeedKph = clamp(
    (car.drsActive ? cornerTargetKph + 22 : cornerTargetKph) -
      edgePenalty -
      steeringPenalty -
      headingPenalty -
      recoveryAlignmentPenalty -
      steeringLoadPenalty -
      simulatorLoadPenalty -
      trafficPenalty,
    minimumDesiredSpeedKph,
    simulatorMode ? 318 : 330,
  );
  const desiredSpeed = clamp(
    kphToSimSpeed(desiredSpeedKph),
    kphToSimSpeed(minimumDesiredSpeedKph),
    VEHICLE_LIMITS.maxSpeed,
  );
  const speedError = desiredSpeed - car.speed;
  const minimumThrottle = edgeGuard.pressure > 0.2 ? 0 : simulatorMode ? 0.04 + aggression * 0.04 : 0.1 + aggression * 0.08;
  const brakeLimit = simulatorMode
    ? car.trackState.surface === 'kerb'
      ? 0.32
      : 0.84 - aggression * 0.05
    : car.trackState.surface === 'kerb'
      ? 0.42
      : 0.72 - aggression * 0.08;
  let brakeAmount = speedError < -kphToSimSpeed(3)
    ? clamp(Math.abs(speedError) / kphToSimSpeed(simulatorMode ? 18 + aggression * 7 : 28 + aggression * 11), 0, brakeLimit)
    : 0;
  if (simulatorMode && (gripUsage > 0.9 || slipAngle > 0.12)) {
    brakeAmount = Math.max(brakeAmount, clamp((gripUsage - 0.78) * 0.28 + slipAngle * 0.34, 0, brakeLimit * 0.45));
  }
  if (edgeGuard.pressure > 0.46 && car.speed > kphToSimSpeed(48)) {
    brakeAmount = Math.max(brakeAmount, clamp((edgeGuard.pressure - 0.42) * 0.9, 0, brakeLimit));
  }
  const recoveryThrottleScale = edgeGuard.pressure > 0.24
    ? 1 - clamp((Math.abs(headingError) - 0.38) / 0.92, 0, 0.82)
    : 1;
  const throttleRequest = speedError > kphToSimSpeed(1)
    ? clamp(speedError / kphToSimSpeed(16), minimumThrottle, 1)
    : 0;
  const steeringLoad = Math.abs(steeringRequest) / Math.max(steeringLimit, 1e-6);
  const simulatorThrottleScale = simulatorMode
    ? clamp(
      1 - steeringLoad * 0.32 - Math.max(0, gripUsage - 0.68) * 0.45 - slipAngle * 1.1 - edgeGuard.pressure * 0.35,
      0,
      1,
    )
    : 1;

  return createDriverInput()
    .steer(steeringRequest)
    .accelerate(brakeAmount > 0.05 ? 0 : throttleRequest * recoveryThrottleScale * simulatorThrottleScale)
    .brake(brakeAmount)
    .controls();
}

export function maxLookaheadCurvature(track, progress, lookahead) {
  let maximum = 0;
  let previous = pointAt(track, progress);
  for (let index = 1; index <= CURVATURE_LOOKAHEAD_SAMPLES; index += 1) {
    const sample = pointAt(track, progress + lookahead * (index / CURVATURE_LOOKAHEAD_SAMPLES));
    const segmentDistance = Math.max(1, lookahead / CURVATURE_LOOKAHEAD_SAMPLES);
    const segmentCurvature = Math.abs(normalizeAngle(sample.heading - previous.heading)) / segmentDistance;
    maximum = Math.max(maximum, Math.abs(sample.curvature ?? 0), Math.min(segmentCurvature, PREVIEW_CURVATURE_CAP));
    previous = sample;
  }
  return maximum;
}

export function calculateRacingLineOffset(car, race, lookahead, curvature, edgeGuard) {
  const cornerStrength = clamp((curvature - 0.00012) / 0.00095, 0, 1);
  if (cornerStrength <= 0) return 0;

  const entry = pointAt(race.track, car.progress - lookahead * 0.35);
  const apex = pointAt(race.track, car.progress + lookahead * 0.55);
  const exit = pointAt(race.track, car.progress + lookahead * 1.25);
  const signedEntry = normalizeAngle(apex.heading - entry.heading);
  const signedExit = normalizeAngle(exit.heading - apex.heading);
  const turnDirection = Math.sign(Math.abs(signedEntry) > Math.abs(signedExit) ? signedEntry : signedExit);
  if (turnDirection === 0) return 0;

  const aggression = car.aggression ?? car.personality?.baseAggression ?? 0.5;
  const simulatorMode = race.physicsMode === 'simulator';
  const safeEdge = race.track.width / 2 - VEHICLE_LIMITS.carWidth *
    (simulatorMode ? 2.05 - aggression * 0.08 : 1.15 - aggression * 0.12);
  const apexOffset = turnDirection * safeEdge *
    (simulatorMode ? 0.18 + aggression * 0.03 : 0.72 + aggression * 0.08);

  return apexOffset * cornerStrength * (1 - edgeGuard.pressure * (simulatorMode ? 0.82 : 0.65));
}
