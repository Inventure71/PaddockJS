import { pointAt, offsetTrackPoint } from './trackModel.js';
import { clamp, normalizeAngle, seededRange, TWO_PI } from './simMath.js';
import { kphToSimSpeed, metersToSimUnits, simSpeedToKph, simUnitsToMeters } from './units.js';
import { VEHICLE_LIMITS } from './vehiclePhysics.js';

const LANE_OFFSETS = [-8, -5.6, -3.2, 0, 3.2, 5.6, 8].map(metersToSimUnits);
const EDGE_RECOVERY_MIN_LOOKAHEAD = metersToSimUnits(28);
const LOOKAHEAD_BASE_DISTANCE = metersToSimUnits(52);
const LOOKAHEAD_MAX_DISTANCE = metersToSimUnits(115);
const BRAKING_LOOKAHEAD_MAX_DISTANCE = metersToSimUnits(560);
const TRAFFIC_GAP_AHEAD = metersToSimUnits(58);
const TRAFFIC_SIDE_GAP = metersToSimUnits(4.1);
const TRAFFIC_SIDE_OVERLAP = metersToSimUnits(4.6);
const TRAFFIC_REAR_WINDOW = metersToSimUnits(42);
const OVERTAKE_GAP_BASE = metersToSimUnits(26);
const OVERTAKE_GAP_AGGRESSION = metersToSimUnits(28);
const OVERTAKE_LATERAL_MIN = metersToSimUnits(2.4);
const OVERTAKE_LATERAL_REWARD = metersToSimUnits(1.35);
const PASS_SIDE_BASE = metersToSimUnits(3.4);
const PASS_SIDE_AGGRESSION = metersToSimUnits(4.6);
const DEFEND_REAR_GAP = metersToSimUnits(46);
const DEFEND_MIN_OFFSET = metersToSimUnits(2.4);
const LANE_EDGE_CLEARANCE_TARGET = metersToSimUnits(0.75);
const REJOIN_LOOKAHEAD_BASE = metersToSimUnits(56);
const REJOIN_LOOKAHEAD_MAX = metersToSimUnits(105);
const SAFETY_CAR_LOOKAHEAD_MIN = metersToSimUnits(24);
const SAFETY_CAR_LOOKAHEAD_MAX = metersToSimUnits(48);
const CURVATURE_LOOKAHEAD_SAMPLES = 5;
const PREVIEW_CURVATURE_CAP = 0.00115;
const REJOIN_HOLD_FRAMES = 150;
const OVERTAKE_COMMIT_FRAMES = 150;

function angleToPoint(car, target) {
  const angle = Math.atan2(target.y - car.y, target.x - car.x);
  return normalizeAngle(angle - car.heading);
}

export function buildDriverPersonality(driver, index, racecraft, random) {
  const numberSeed = Number(driver.driverNumber ?? index + 1);
  const numberBias = (((Number.isFinite(numberSeed) ? numberSeed : index + 1) % 11) - 5) * 0.014;
  const baseAggression = clamp(
    driver.personality?.aggression ?? 0.36 + racecraft * 0.34 + numberBias + seededRange(random, -0.045, 0.045),
    0.18,
    0.88,
  );

  return {
    baseAggression,
    riskTolerance: clamp(
      driver.personality?.riskTolerance ?? baseAggression * 0.72 + racecraft * 0.24 + seededRange(random, -0.04, 0.04),
      0.12,
      0.95,
    ),
    patience: clamp(
      driver.personality?.patience ?? 0.72 - baseAggression * 0.36 + racecraft * 0.12 + seededRange(random, -0.05, 0.05),
      0.18,
      0.9,
    ),
  };
}

export function createDriverInput() {
  const state = {
    steering: 0,
    throttle: 0,
    brake: 0,
  };

  return {
    steer(amount) {
      state.steering = clamp(amount, -VEHICLE_LIMITS.maxSteer, VEHICLE_LIMITS.maxSteer);
      return this;
    },
    accelerate(amount) {
      state.throttle = clamp(amount, 0, 1);
      return this;
    },
    brake(amount) {
      state.brake = clamp(amount, 0, 1);
      return this;
    },
    controls() {
      return { ...state };
    },
  };
}

export function decideDriverControls({ car, orderIndex, race }) {
  if (car.manualControls) return car.manualControls;

  if (car.gridLocked) {
    return createDriverInput().brake(1).controls();
  }

  if (race.safetyCar.deployed) {
    return decideSafetyCarControls(car, orderIndex, race);
  }

  if (!car.trackState.onTrack) {
    car.rejoinRecoveryFrames = REJOIN_HOLD_FRAMES;
    car.attackCommitmentFrames = 0;
    return decideRejoinControls(car, race);
  }

  if (shouldContinueRejoinRecovery(car, race)) {
    return decideRejoinControls(car, race);
  }

  return decideRacingControls(car, orderIndex, race);
}

function decideRacingControls(car, orderIndex, race) {
  const aggression = car.aggression ?? car.personality?.baseAggression ?? 0.5;
  const edgeGuard = calculateTrackEdgeGuard(car, race);
  const baseLookahead = clamp(
    car.speed * (1.62 - aggression * 0.12) + LOOKAHEAD_BASE_DISTANCE - edgeGuard.pressure * metersToSimUnits(18),
    EDGE_RECOVERY_MIN_LOOKAHEAD,
    LOOKAHEAD_MAX_DISTANCE,
  );
  const previewLookahead = clamp(
    car.speed * 3.15 + LOOKAHEAD_BASE_DISTANCE,
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
  const targetOffset = clamp(
    (lanePlan.offset + racingOffset * racingLineWeight) * cornerOffsetFactor * (1 - edgeGuard.pressure * 0.8) +
      recoveryOffset * edgeGuard.pressure * 0.8,
    -edgeGuard.recoveryOffset,
    edgeGuard.recoveryOffset,
  );
  const target = offsetTrackPoint(targetBase, targetOffset);
  const angleError = angleToPoint(car, target);
  const headingError = normalizeAngle(targetBase.heading - car.heading);
  const lateralError = car.trackState?.signedOffset ?? 0;
  const cornerCommitment = clamp(Math.abs(headingError) / 0.9, 0, 0.72);
  const lateralCorrection = -Math.atan2(
    lateralError * (0.85 + edgeGuard.pressure * 0.5),
    Math.max(car.speed, kphToSimSpeed(35)),
  ) * (1 - cornerCommitment * 0.62);
  const headingFeedForward = clamp(
    headingError * (0.34 + car.racecraft * 0.18 + edgeGuard.pressure * 0.12),
    -0.42,
    0.42,
  );
  let pathSteer = angleError * (0.72 + car.racecraft * 0.12 + edgeGuard.pressure * 0.42) + headingFeedForward;
  if (edgeGuard.side !== 0 && Math.sign(pathSteer) === edgeGuard.side) {
    pathSteer *= 1 - edgeGuard.pressure * 0.85;
  }
  const edgeRecoverySteer = -edgeGuard.side * clamp(
    (edgeGuard.pressure - 0.22) * 1.18 + edgeGuard.overLimitPressure * 0.55,
    0,
    0.52,
  );
  const steeringLimit = car.trackState.surface === 'kerb'
    ? VEHICLE_LIMITS.maxSteer * 0.96
    : VEHICLE_LIMITS.maxSteer;
  const steeringRequest = clamp(pathSteer + lateralCorrection + edgeRecoverySteer, -steeringLimit, steeringLimit);
  const cornerRadiusMeters = simUnitsToMeters(1 / Math.max(curvature, 1e-7));
  const lateralGripBudget = 14.8 + car.racecraft * 3.4 + (car.tireEnergy ?? 100) * 0.011 + aggression * 1.8;
  const cornerTargetKph = clamp(
    Math.sqrt(lateralGripBudget * cornerRadiusMeters) * 3.6 * (1.1 + aggression * 0.08) +
      (car.pace - 1) * 20 + aggression * 10,
    96,
    318,
  );
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
    ? 34
    : car.trackState.surface === 'kerb' ? 58 : 52;
  const desiredSpeedKph = clamp(
    (car.drsActive ? cornerTargetKph + 22 : cornerTargetKph) -
      edgePenalty -
      steeringPenalty -
      headingPenalty -
      recoveryAlignmentPenalty -
      steeringLoadPenalty -
      trafficPenalty,
    minimumDesiredSpeedKph,
    330,
  );
  const desiredSpeed = clamp(
    kphToSimSpeed(desiredSpeedKph),
    kphToSimSpeed(minimumDesiredSpeedKph),
    VEHICLE_LIMITS.maxSpeed,
  );
  const speedError = desiredSpeed - car.speed;
  const minimumThrottle = edgeGuard.pressure > 0.2 ? 0 : 0.1 + aggression * 0.08;
  const brakeLimit = car.trackState.surface === 'kerb'
    ? 0.42
    : 0.72 - aggression * 0.08;
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

function maxLookaheadCurvature(track, progress, lookahead) {
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

function calculateRacingLineOffset(car, race, lookahead, curvature, edgeGuard) {
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
  const safeEdge = race.track.width / 2 - VEHICLE_LIMITS.carWidth * (1.15 - aggression * 0.12);
  const apexOffset = turnDirection * safeEdge * (0.72 + aggression * 0.08);

  return apexOffset * cornerStrength * (1 - edgeGuard.pressure * 0.65);
}

function calculateTrackEdgeGuard(car, race) {
  const trackLimit = race.track.width / 2;
  const halfCarWidth = VEHICLE_LIMITS.carWidth / 2;
  const wholeCarOutsideLimit = trackLimit + halfCarWidth;
  const softLimit = trackLimit - halfCarWidth * 1.9;
  const recoveryOffset = trackLimit - halfCarWidth * 1.62;
  const crossTrackError = car.trackState?.crossTrackError ?? 0;
  const side = Math.sign(car.trackState?.signedOffset ?? 0);
  const pressure = clamp(
    (crossTrackError - softLimit) / Math.max(1, wholeCarOutsideLimit - softLimit),
    0,
    1,
  );
  const overLimitPressure = clamp(
    (crossTrackError - wholeCarOutsideLimit) / Math.max(1, (race.track.kerbWidth ?? 0) + halfCarWidth),
    0,
    1,
  );

  return {
    softLimit,
    recoveryOffset,
    pressure,
    overLimitPressure,
    side,
  };
}

function shouldContinueRejoinRecovery(car, race) {
  const frames = Math.max(0, Math.floor(car.rejoinRecoveryFrames ?? 0));
  if (frames <= 0) return false;

  const lookahead = clamp(car.speed * 0.66 + REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_MAX);
  const targetBase = pointAt(race.track, car.progress + lookahead);
  const headingError = Math.abs(normalizeAngle(targetBase.heading - car.heading));
  const edgeBuffer = race.track.width / 2 - VEHICLE_LIMITS.carWidth * 1.35;
  const stillUnsettled = car.trackState.crossTrackError > edgeBuffer || headingError > 0.34;

  car.rejoinRecoveryFrames = stillUnsettled ? frames - 1 : 0;
  return stillUnsettled;
}

function decideRejoinControls(car, race) {
  const lookahead = clamp(car.speed * 0.72 + REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_MAX);
  const distanceFromRoadMeters = simUnitsToMeters(Math.max(0, car.trackState.crossTrackError - race.track.width / 2));
  const targetBase = !car.trackState.onTrack && distanceFromRoadMeters > 2.5
    ? pointAt(race.track, car.progress)
    : pointAt(race.track, car.progress + lookahead * 0.78);
  const signedSide = Math.sign(car.trackState?.signedOffset ?? 0);
  const rejoinOffset = signedSide !== 0 && (
    distanceFromRoadMeters > 0.5 ||
    car.trackState.crossTrackError > race.track.width / 2 - VEHICLE_LIMITS.carWidth * 1.6
  )
    ? -signedSide * race.track.width * 0.22
    : 0;
  const target = offsetTrackPoint(targetBase, rejoinOffset);
  const angleError = angleToPoint(car, target);
  const surfaceTargetSpeedKph = car.trackState.surface === 'track'
    ? 88
    : car.trackState.surface === 'kerb'
      ? 72
      : car.trackState.surface === 'gravel'
        ? 56
        : car.trackState.surface === 'grass'
          ? 48
          : 34;
  const alignment = clamp(1 - Math.abs(angleError) / Math.PI, 0.22, 1);
  const desiredSpeed = kphToSimSpeed(clamp(
    surfaceTargetSpeedKph * (0.62 + alignment * 0.38) - distanceFromRoadMeters * 0.065,
    car.trackState.surface === 'barrier' ? 12 : 24,
    surfaceTargetSpeedKph,
  ));
  const speedError = desiredSpeed - car.speed;
  const lowSpeedRecovery = car.speed < kphToSimSpeed(18)
    ? car.trackState.surface === 'barrier' ? 0.34 : 0.18
    : 0;
  const throttleLimit = car.trackState.surface === 'barrier'
    ? 0.68
    : car.trackState.surface === 'gravel' ? 0.46 : 0.42;
  const brakeAmount = speedError < -kphToSimSpeed(5)
    ? clamp(Math.abs(speedError) / kphToSimSpeed(30), 0.04, car.trackState.onTrack ? 0.46 : 0.74)
    : 0;

  return createDriverInput()
    .steer(angleError * 1.65)
    .accelerate(brakeAmount > 0.05 ? 0 : speedError > 0
      ? clamp((speedError / kphToSimSpeed(24)) * alignment + lowSpeedRecovery, 0.08, throttleLimit)
      : lowSpeedRecovery)
    .brake(brakeAmount)
    .controls();
}

function decideSafetyCarControls(car, orderIndex, race) {
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

export function planRacingLine(car, orderIndex, race) {
  const aggression = car.aggression ?? car.personality?.baseAggression ?? 0.5;
  const riskTolerance = car.personality?.riskTolerance ?? aggression;
  const trackLimit = race.track.width / 2 - VEHICLE_LIMITS.carWidth * clamp(1.55 - aggression * 0.28, 1.26, 1.55);
  const preferred = Math.sin((car.index / Math.max(1, race.cars.length)) * TWO_PI) * metersToSimUnits(1.1);
  const currentOffset = clamp(car.desiredOffset ?? preferred, -trackLimit, trackLimit);
  const ahead = race.orderedCars[orderIndex - 1];
  const traffic = scanNearbyTraffic(car, race);
  const rearThreat = findDefensiveThreat(traffic);
  const attackPlan = planAttackCommitment(car, ahead, traffic, trackLimit, aggression, race);

  let bestOffset = currentOffset;
  let bestScore = -Infinity;

  LANE_OFFSETS.forEach((rawOffset) => {
    const offset = clamp(rawOffset, -trackLimit, trackLimit);
    const edgeClearance = trackLimit - Math.abs(offset);
    let score = 80;
    score -= Math.abs(offset - preferred) * 0.18;
    score -= Math.abs(offset - currentOffset) * (0.09 - aggression * 0.025);
    score -= Math.max(0, LANE_EDGE_CLEARANCE_TARGET - edgeClearance) * (0.92 - aggression * 0.42);

    traffic.forEach((entry) => {
      const lateral = Math.abs(entry.signedOffset - offset);
      if (entry.gap > 0 && entry.gap < TRAFFIC_GAP_AHEAD) {
        const overlapRisk = clamp(TRAFFIC_SIDE_OVERLAP - lateral, 0, TRAFFIC_SIDE_OVERLAP);
        score -= overlapRisk * (TRAFFIC_GAP_AHEAD - entry.gap) * 0.038 * (1 - riskTolerance * 0.34);
        if (entry.gap < OVERTAKE_GAP_BASE + aggression * OVERTAKE_GAP_AGGRESSION && lateral > OVERTAKE_LATERAL_MIN - aggression * metersToSimUnits(4)) {
          score += Math.min(metersToSimUnits(14) + aggression * metersToSimUnits(8.5), lateral - (OVERTAKE_LATERAL_REWARD - aggression * metersToSimUnits(3))) * (0.62 + aggression * 0.82);
        }
      } else if (entry.gap <= 0 && entry.gap > -TRAFFIC_SIDE_OVERLAP) {
        const sideOverlapRisk = clamp(TRAFFIC_SIDE_OVERLAP - lateral, 0, TRAFFIC_SIDE_OVERLAP);
        score -= sideOverlapRisk * (TRAFFIC_SIDE_OVERLAP + entry.gap) * 0.052 * (1 - riskTolerance * 0.22);
      }
    });

    if (ahead && car.gapAhead < TRAFFIC_GAP_AHEAD) {
      const passSide = attackPlan?.targetOffset ?? clamp(
        (ahead.trackState.signedOffset * -0.65) + (car.index % 2 === 0 ? -1 : 1) * (PASS_SIDE_BASE + aggression * PASS_SIDE_AGGRESSION),
        -trackLimit,
        trackLimit,
      );
      const attackPressure = attackPlan?.pressure ?? 0.45;
      score -= Math.abs(offset - passSide) * (0.12 + aggression * 0.16) * attackPressure;
      if (attackPlan && Math.sign(offset || passSide) === attackPlan.side && Math.abs(offset - ahead.trackState.signedOffset) > OVERTAKE_LATERAL_MIN) {
        score += metersToSimUnits(4 + aggression * 5) * attackPressure;
      }
    }

    const defenseIntensity = clamp((aggression - 0.5) / 0.3, 0, 1) *
      clamp((Math.max(riskTolerance, aggression) - 0.42) / 0.4, 0, 1);
    if (rearThreat && defenseIntensity > 0.04) {
      const threatSide = Math.sign(rearThreat.signedOffset || currentOffset || (car.index % 2 === 0 ? 1 : -1));
      const defendOffset = clamp(
        threatSide * Math.max(Math.abs(rearThreat.signedOffset) + metersToSimUnits(0.8), DEFEND_MIN_OFFSET),
        -trackLimit,
        trackLimit,
      );
      const closingPressure = clamp((DEFEND_REAR_GAP + rearThreat.gap) / DEFEND_REAR_GAP, 0, 1);
      score -= Math.abs(offset - defendOffset) * (0.75 + aggression * 0.45) * closingPressure * defenseIntensity;
      if (Math.sign(offset) === threatSide && Math.abs(offset) >= DEFEND_MIN_OFFSET) {
        score += metersToSimUnits(10) * (0.42 + aggression * 0.36) * closingPressure * defenseIntensity;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  });

  const laneChangeRate = metersToSimUnits(0.95 + car.racecraft * 0.32 + aggression * 0.78);
  car.desiredOffset = currentOffset + clamp(bestOffset - currentOffset, -laneChangeRate, laneChangeRate);

  return {
    offset: car.desiredOffset,
    sameLaneAhead: findLaneTrafficAhead(traffic, car.desiredOffset, TRAFFIC_GAP_AHEAD),
    actualLaneAhead: findLaneTrafficAhead(traffic, car.trackState?.signedOffset ?? car.desiredOffset, TRAFFIC_GAP_AHEAD),
    sideRisk: findLaneTrafficBeside(traffic, car.desiredOffset),
    attackCommitted: Boolean(attackPlan),
  };
}

function calculatePlannedTrafficPenalty(entry, plannedPassingOverlap) {
  return clamp(
    simUnitsToMeters(TRAFFIC_GAP_AHEAD - entry.gap) * (plannedPassingOverlap ? 0.08 : 0.16),
    0,
    plannedPassingOverlap ? 24 : 32,
  );
}

function calculateActualOverlapPenalty(car, entry) {
  const gapMeters = simUnitsToMeters(entry.gap);
  const closingKph = Math.max(0, simSpeedToKph(car.speed - (entry.speed ?? car.speed)));
  const urgent = gapMeters < 9
    ? (9 - gapMeters) * (2.2 + closingKph * 0.03)
    : 0;

  return clamp(urgent, 0, 58);
}

function planAttackCommitment(car, ahead, traffic, trackLimit, aggression, race) {
  const existingFrames = Math.max(0, Math.floor(car.attackCommitmentFrames ?? 0));
  const relativeSpeed = ahead ? car.speed - ahead.speed : 0;
  const closeEnough = ahead &&
    car.gapAhead > 0 &&
    car.gapAhead < OVERTAKE_GAP_BASE + aggression * OVERTAKE_GAP_AGGRESSION + metersToSimUnits(28);
  const speedPressure = clamp(relativeSpeed / kphToSimSpeed(34), -0.4, 1);

  if (closeEnough && speedPressure > -0.15) {
    const aheadOffset = ahead.trackState?.signedOffset ?? 0;
    const currentSide = Math.sign(car.attackSide ?? 0);
    const blockedCommitment = currentSide &&
      Math.sign(aheadOffset || currentSide) === currentSide &&
      Math.abs(aheadOffset - (car.trackState?.signedOffset ?? 0)) < TRAFFIC_SIDE_GAP &&
      Math.abs(aheadOffset) > trackLimit * 0.55;

    if (!existingFrames || !currentSide || blockedCommitment) {
      const leftSpace = trackLimit + aheadOffset;
      const rightSpace = trackLimit - aheadOffset;
      const preferredSide = leftSpace > rightSpace ? -1 : 1;
      const freeSide = chooseFreerAttackSide(traffic, preferredSide);
      car.attackSide = freeSide;
    }
    car.attackCommitmentFrames = OVERTAKE_COMMIT_FRAMES;
  } else if (existingFrames > 0) {
    car.attackCommitmentFrames = existingFrames - 1;
  } else {
    car.attackSide = 0;
    car.attackCommitmentFrames = 0;
  }

  const side = Math.sign(car.attackSide ?? 0);
  if (!side || !ahead) return null;

  const targetOffset = clamp(
    (ahead.trackState?.signedOffset ?? 0) + side * (PASS_SIDE_BASE + aggression * PASS_SIDE_AGGRESSION + metersToSimUnits(2.4)),
    -trackLimit,
    trackLimit,
  );
  const pressure = clamp(
    0.48 +
      aggression * 0.34 +
      speedPressure * 0.28 +
      (car.attackCommitmentFrames ?? 0) / OVERTAKE_COMMIT_FRAMES * 0.22,
    0.45,
    1.15,
  );

  return { side, targetOffset, pressure };
}

function chooseFreerAttackSide(traffic, preferredSide) {
  const sideScore = (side) => traffic.reduce((score, entry) => {
    if (entry.gap < -TRAFFIC_REAR_WINDOW || entry.gap > TRAFFIC_GAP_AHEAD) return score;
    const sameSide = Math.sign(entry.signedOffset || side) === side;
    return score - (sameSide ? 1 : 0) * (1 - clamp(Math.abs(entry.gap) / TRAFFIC_GAP_AHEAD, 0, 1));
  }, side === preferredSide ? 0.18 : 0);
  return sideScore(1) >= sideScore(-1) ? 1 : -1;
}

function scanNearbyTraffic(car, race) {
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

function findDefensiveThreat(traffic) {
  let closest = null;

  traffic.forEach((entry) => {
    if (entry.gap >= -VEHICLE_LIMITS.carLength * 1.1 || entry.gap < -DEFEND_REAR_GAP) return;
    if (!closest || entry.gap > closest.gap) closest = entry;
  });

  return closest;
}

function findLaneTrafficAhead(traffic, offset, maxDistance) {
  let closest = null;

  traffic.forEach((entry) => {
    if (entry.gap <= 0 || entry.gap > maxDistance) return;
    if (Math.abs(entry.signedOffset - offset) > TRAFFIC_SIDE_GAP) return;
    if (!closest || entry.gap < closest.gap) closest = entry;
  });

  return closest;
}

function findLaneTrafficBeside(traffic, offset) {
  let closest = null;

  traffic.forEach((entry) => {
    const lateral = Math.abs(entry.signedOffset - offset);
    if (Math.abs(entry.gap) > metersToSimUnits(28) || lateral > TRAFFIC_SIDE_GAP) return;
    const risk = (metersToSimUnits(28) - Math.abs(entry.gap)) + (TRAFFIC_SIDE_GAP - lateral);
    if (!closest || risk > closest.risk) closest = { ...entry, lateral, risk };
  });

  return closest;
}
