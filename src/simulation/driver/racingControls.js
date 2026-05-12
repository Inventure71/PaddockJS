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
  if (race.physicsMode === 'simulator') {
    return decideSimulatorRacingControls(car, orderIndex, race);
  }
  return decideArcadeRacingControls(car, orderIndex, race);
}

export function decideArcadeRacingControls(car, orderIndex, race) {
  return decideRacingControlsForMode(car, orderIndex, race, {
    simulatorMode: false,
    baseLookaheadSpeedFactor: (aggression) => 1.62 - aggression * 0.12,
    previewLookaheadSpeedFactor: 3.15,
    edgeLookaheadPenaltyMeters: 18,
    cornerPressureCurvature: 0.001,
    edgeLineDamping: 0.8,
    edgeRecoveryWeight: 0.8,
    headingFeedForwardBase: (carEntry, edgeGuard) => 0.34 + carEntry.racecraft * 0.18 + edgeGuard.pressure * 0.12,
    headingFeedForwardLimit: 0.42,
    pathSteerGain: (carEntry, edgeGuard) => 0.72 + carEntry.racecraft * 0.12 + edgeGuard.pressure * 0.42,
    edgeRecoveryStart: 0.22,
    edgeRecoveryGain: 1.18,
    edgeRecoveryOverLimitGain: 0.55,
    edgeRecoveryLimit: 0.52,
    steeringLimitScale: () => 1,
    gripBudget: (carEntry, aggression) => 14.8 + carEntry.racecraft * 3.4 + (carEntry.tireEnergy ?? 100) * 0.011 + aggression * 1.8,
    cornerSpeedMultiplier: (aggression) => 1.12 + aggression * 0.08,
    paceBonus: (carEntry) => (carEntry.pace - 1) * 20,
    aggressionSpeedBonus: (aggression) => aggression * 10,
    minCornerSpeedKph: 96,
    maxCornerSpeedKph: 318,
    edgePenaltyMetersScale: (aggression) => 5.8 - aggression * 1.1,
    edgePenaltyPressure: 48,
    edgePressureSpeedPenalty: 0,
    steeringPenaltyStart: 0.38,
    steeringPenaltyGain: 24,
    steeringPenaltyMax: 12,
    headingPenaltyStart: 0.48,
    headingPenaltyGain: 42,
    headingPenaltyMax: 24,
    recoveryHeadingStart: 0.46,
    recoveryHeadingGain: 64,
    recoveryHeadingMax: 38,
    steeringLoadStart: 0.82,
    steeringLoadMax: 18,
    steeringLoadHeadingScale: 0.48,
    loadPenalty: () => 0,
    minimumSpeeds: { edge: 34, kerb: 58, track: 52 },
    desiredSpeedMaxKph: 330,
    minimumThrottle: (aggression) => 0.1 + aggression * 0.08,
    brakeLimits: { kerb: (aggression) => 0.42, track: (aggression) => 0.72 - aggression * 0.08 },
    brakeResponseKph: (aggression) => 28 + aggression * 11,
    extraGripBrake: () => 0,
    edgeBrakeLimitScale: 1,
    recoveryHeadingThrottleStart: 0.38,
    throttleResponseKph: 16,
    throttleScale: () => 1,
  });
}

export function decideSimulatorRacingControls(car, orderIndex, race) {
  return decideRacingControlsForMode(car, orderIndex, race, {
    simulatorMode: true,
    baseLookaheadSpeedFactor: (aggression) => 2.45 - aggression * 0.06,
    previewLookaheadSpeedFactor: 6.15,
    edgeLookaheadPenaltyMeters: 34,
    cornerPressureCurvature: 0.00072,
    edgeLineDamping: 1.55,
    edgeRecoveryWeight: 1.45,
    headingFeedForwardBase: (carEntry, edgeGuard) => 0.2 + carEntry.racecraft * 0.08 + edgeGuard.pressure * 0.07,
    headingFeedForwardLimit: 0.25,
    pathSteerGain: (carEntry, edgeGuard) => 0.46 + carEntry.racecraft * 0.06 + edgeGuard.pressure * 0.18,
    edgeRecoveryStart: 0.04,
    edgeRecoveryGain: 3.1,
    edgeRecoveryOverLimitGain: 1.15,
    edgeRecoveryLimit: 0.78,
    steeringLimitScale: (carEntry, speedRatio, gripUsage) => clamp(1 - speedRatio * 0.55 - gripUsage * 0.14, 0.26, 1),
    gripBudget: (carEntry, aggression) => 10.6 + carEntry.racecraft * 1.55 + (carEntry.tireEnergy ?? 100) * 0.006 + aggression * 0.55,
    cornerSpeedMultiplier: (aggression) => 0.93 + aggression * 0.035,
    paceBonus: (carEntry) => (carEntry.pace - 1) * 12,
    aggressionSpeedBonus: (aggression) => aggression * 4,
    minCornerSpeedKph: 58,
    maxCornerSpeedKph: 292,
    edgePenaltyMetersScale: (aggression) => 10.5 - aggression * 0.8,
    edgePenaltyPressure: 92,
    edgePressureSpeedPenalty: 32,
    steeringPenaltyStart: 0.27,
    steeringPenaltyGain: 42,
    steeringPenaltyMax: 28,
    headingPenaltyStart: 0.32,
    headingPenaltyGain: 62,
    headingPenaltyMax: 42,
    recoveryHeadingStart: 0.28,
    recoveryHeadingGain: 86,
    recoveryHeadingMax: 58,
    steeringLoadStart: 0.58,
    steeringLoadMax: 36,
    steeringLoadHeadingScale: 0.32,
    loadPenalty: (entry, gripUsage, slipAngle, cornerPressure, outwardDriftAngle) =>
      clamp((gripUsage - 0.52) * 92, 0, 54) +
      clamp(slipAngle * 130, 0, 42) +
      cornerPressure * 18 +
      clamp(outwardDriftAngle * 330, 0, 62),
    minimumSpeeds: { edge: 34, kerb: 44, track: 42 },
    desiredSpeedMaxKph: 302,
    minimumThrottle: (aggression) => 0.03 + aggression * 0.03,
    brakeLimits: { kerb: (aggression) => 0.36, track: (aggression) => 0.9 - aggression * 0.03 },
    brakeResponseKph: (aggression) => 15 + aggression * 5,
    extraGripBrake: (gripUsage, slipAngle, brakeLimit) => clamp((gripUsage - 0.68) * 0.42 + slipAngle * 0.5, 0, brakeLimit * 0.6),
    edgeBrakeLimitScale: 1.08,
    recoveryHeadingThrottleStart: 0.3,
    throttleResponseKph: 18,
    throttleScale: (steeringLoad, gripUsage, slipAngle, edgeGuard) => clamp(
      1 - steeringLoad * 0.42 - Math.max(0, gripUsage - 0.58) * 0.58 - slipAngle * 1.25 - edgeGuard.pressure * 0.42,
      0,
      1,
    ),
  });
}

function decideRacingControlsForMode(car, orderIndex, race, profile) {
  const aggression = car.aggression ?? car.personality?.baseAggression ?? 0.5;
  const simulatorMode = profile.simulatorMode;
  const edgeGuard = calculateTrackEdgeGuard(car, race);
  const gripUsage = Number.isFinite(car.gripUsage) ? car.gripUsage : 0;
  const slipAngle = Math.abs(car.slipAngleRadians ?? 0);
  const baseLookahead = clamp(
    car.speed * profile.baseLookaheadSpeedFactor(aggression) +
      LOOKAHEAD_BASE_DISTANCE -
      edgeGuard.pressure * metersToSimUnits(profile.edgeLookaheadPenaltyMeters),
    EDGE_RECOVERY_MIN_LOOKAHEAD,
    LOOKAHEAD_MAX_DISTANCE,
  );
  const previewLookahead = clamp(
    car.speed * profile.previewLookaheadSpeedFactor + LOOKAHEAD_BASE_DISTANCE,
    baseLookahead,
    BRAKING_LOOKAHEAD_MAX_DISTANCE,
  );
  const previewCurvature = maxLookaheadCurvature(race.track, car.progress, previewLookahead);
  const cornerPressure = clamp(previewCurvature / profile.cornerPressureCurvature, 0, 1);
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
  const targetOffset = clamp(
    (lanePlan.offset + racingOffset * racingLineWeight) * cornerOffsetFactor * (1 - edgeGuard.pressure * profile.edgeLineDamping) +
      recoveryOffset * edgeGuard.pressure * profile.edgeRecoveryWeight,
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
    headingError * profile.headingFeedForwardBase(car, edgeGuard),
    -profile.headingFeedForwardLimit,
    profile.headingFeedForwardLimit,
  );
  let pathSteer = angleError * profile.pathSteerGain(car, edgeGuard) + headingFeedForward;
  if (edgeGuard.side !== 0 && Math.sign(pathSteer) === edgeGuard.side) {
    pathSteer *= 1 - edgeGuard.pressure * 0.85;
  }
  const edgeRecoverySteer = -edgeGuard.side * clamp(
    (edgeGuard.pressure - profile.edgeRecoveryStart) * profile.edgeRecoveryGain +
      edgeGuard.overLimitPressure * profile.edgeRecoveryOverLimitGain +
      (simulatorMode ? outwardDriftAngle * clamp(Math.abs(lateralError) / (race.track.width * 0.26), 0, 1) * 1.8 : 0),
    0,
    profile.edgeRecoveryLimit,
  );
  const speedRatio = clamp(car.speed / VEHICLE_LIMITS.maxSpeed, 0, 1);
  const simulatorSteeringLimit = VEHICLE_LIMITS.maxSteer *
    profile.steeringLimitScale(car, speedRatio, gripUsage);
  const steeringLimit = simulatorMode
    ? (car.trackState.surface === 'kerb' ? simulatorSteeringLimit * 0.82 : simulatorSteeringLimit)
    : car.trackState.surface === 'kerb'
      ? VEHICLE_LIMITS.maxSteer * 0.96
      : VEHICLE_LIMITS.maxSteer;
  let steeringRequest = clamp(pathSteer + lateralCorrection + edgeRecoverySteer, -steeringLimit, steeringLimit);
  if (simulatorMode && edgeGuard.pressure > 0.62 && Math.sign(steeringRequest) === edgeGuard.side) {
    steeringRequest = clamp(
      -edgeGuard.side * Math.max(Math.abs(steeringRequest), steeringLimit * 0.55),
      -steeringLimit,
      steeringLimit,
    );
  }
  const cornerRadiusMeters = simUnitsToMeters(1 / Math.max(curvature, 1e-7));
  const lateralGripBudget = profile.gripBudget(car, aggression);
  const cornerTargetKph = clamp(
    Math.sqrt(lateralGripBudget * cornerRadiusMeters) * 3.6 *
      profile.cornerSpeedMultiplier(aggression) +
      profile.paceBonus(car) + profile.aggressionSpeedBonus(aggression),
    profile.minCornerSpeedKph,
    profile.maxCornerSpeedKph,
  );
  const edgePenalty = edgeGuard.pressure > 0.42
    ? simUnitsToMeters(Math.max(0, car.trackState.crossTrackError - edgeGuard.softLimit)) *
      profile.edgePenaltyMetersScale(aggression) +
      edgeGuard.overLimitPressure * profile.edgePenaltyPressure
    : edgeGuard.overLimitPressure * profile.edgePenaltyPressure +
      edgeGuard.pressure * profile.edgePressureSpeedPenalty;
  const steeringPenalty = clamp((Math.abs(angleError) - profile.steeringPenaltyStart) * profile.steeringPenaltyGain, 0, profile.steeringPenaltyMax);
  const headingPenalty = clamp((Math.abs(headingError) - profile.headingPenaltyStart) * profile.headingPenaltyGain, 0, profile.headingPenaltyMax);
  const recoveryAlignmentPenalty = edgeGuard.pressure > 0.2
    ? clamp((Math.abs(headingError) - profile.recoveryHeadingStart) * profile.recoveryHeadingGain, 0, profile.recoveryHeadingMax)
    : 0;
  const steeringLoadPenalty = clamp(
    (Math.abs(steeringRequest) / Math.max(steeringLimit, 1e-6) - profile.steeringLoadStart) * 42,
    0,
    profile.steeringLoadMax,
  ) * clamp(Math.abs(headingError) / profile.steeringLoadHeadingScale, 0, 1);
  const simulatorLoadPenalty = profile.loadPenalty(car, gripUsage, slipAngle, cornerPressure, outwardDriftAngle);
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
    lanePlan.sideRisk ? clamp(simUnitsToMeters(TRAFFIC_SIDE_GAP - lanePlan.sideRisk.lateral) * 0.78, 0, 30) : 0,
  ) * (1 - aggression * 0.28);
  const minimumDesiredSpeedKph = edgeGuard.pressure > 0.55
    ? profile.minimumSpeeds.edge
    : car.trackState.surface === 'kerb' ? profile.minimumSpeeds.kerb : profile.minimumSpeeds.track;
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
    profile.desiredSpeedMaxKph,
  );
  const desiredSpeed = clamp(
    kphToSimSpeed(desiredSpeedKph),
    kphToSimSpeed(minimumDesiredSpeedKph),
    VEHICLE_LIMITS.maxSpeed,
  );
  const speedError = desiredSpeed - car.speed;
  const minimumThrottle = edgeGuard.pressure > 0.2 ? 0 : profile.minimumThrottle(aggression);
  const brakeLimit = simulatorMode
    ? car.trackState.surface === 'kerb'
      ? profile.brakeLimits.kerb(aggression)
      : profile.brakeLimits.track(aggression)
    : car.trackState.surface === 'kerb'
      ? profile.brakeLimits.kerb(aggression)
      : profile.brakeLimits.track(aggression);
  let brakeAmount = speedError < -kphToSimSpeed(3)
    ? clamp(Math.abs(speedError) / kphToSimSpeed(profile.brakeResponseKph(aggression)), 0, brakeLimit)
    : 0;
	  if (simulatorMode && (gripUsage > 0.9 || slipAngle > 0.12)) {
	    brakeAmount = Math.max(brakeAmount, profile.extraGripBrake(gripUsage, slipAngle, brakeLimit));
	  }
	  if (simulatorMode && car.speed < kphToSimSpeed(58) && edgeGuard.pressure < 0.75) {
	    brakeAmount *= 0.25;
	  }
	  if (edgeGuard.pressure > 0.46 && car.speed > kphToSimSpeed(48)) {
    brakeAmount = Math.max(brakeAmount, clamp((edgeGuard.pressure - 0.42) * 0.9 * profile.edgeBrakeLimitScale, 0, brakeLimit));
  }
  const recoveryThrottleScale = edgeGuard.pressure > 0.24
    ? 1 - clamp((Math.abs(headingError) - profile.recoveryHeadingThrottleStart) / 0.92, 0, 0.82)
    : 1;
  const throttleRequest = speedError > kphToSimSpeed(1)
    ? clamp(speedError / kphToSimSpeed(profile.throttleResponseKph), minimumThrottle, 1)
    : 0;
  const steeringLoad = Math.abs(steeringRequest) / Math.max(steeringLimit, 1e-6);
  const simulatorThrottleScale = profile.throttleScale(steeringLoad, gripUsage, slipAngle, edgeGuard);

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
    (simulatorMode ? 0.42 + aggression * 0.05 : 0.72 + aggression * 0.08);

  return apexOffset * cornerStrength * (1 - edgeGuard.pressure * (simulatorMode ? 0.82 : 0.65));
}
