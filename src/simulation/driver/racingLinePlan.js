import { clamp, TWO_PI } from '../simMath.js';
import { kphToSimSpeed, metersToSimUnits, simSpeedToKph, simUnitsToMeters } from '../units.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';
import { DEFEND_MIN_OFFSET, DEFEND_REAR_GAP, LANE_EDGE_CLEARANCE_TARGET, LANE_OFFSETS, OVERTAKE_COMMIT_FRAMES, OVERTAKE_GAP_AGGRESSION, OVERTAKE_GAP_BASE, OVERTAKE_LATERAL_MIN, OVERTAKE_LATERAL_REWARD, PASS_SIDE_AGGRESSION, PASS_SIDE_BASE, TRAFFIC_GAP_AHEAD, TRAFFIC_REAR_WINDOW, TRAFFIC_SIDE_GAP, TRAFFIC_SIDE_OVERLAP } from './driverControlConstants.js';
import { findDefensiveThreat, findLaneTrafficAhead, findLaneTrafficBeside, scanNearbyTraffic, mainTrackCenterOffset, followingSpeedFromTraffic, laneMovementBounds } from './trafficScan.js';

export function planRacingLine(car, orderIndex, race) {
  const aggression = car.aggression ?? car.personality?.baseAggression ?? 0.5;
  const riskTolerance = car.personality?.riskTolerance ?? aggression;
  const trackLimit = race.track.width / 2 - VEHICLE_LIMITS.carWidth * clamp(1.55 - aggression * 0.28, 1.26, 1.55);
  const preferred = Math.sin((car.index / Math.max(1, race.cars.length)) * TWO_PI) * metersToSimUnits(1.1);
  const currentOffset = clamp(car.desiredOffset ?? preferred, -trackLimit, trackLimit);
  const traffic = scanNearbyTraffic(car, race);
  const corridorLimit = race.track.width / 2 + VEHICLE_LIMITS.carWidth / 2;
  let aheadEntry = null;
  for (let index = 0; index < traffic.length; index += 1) {
    const entry = traffic[index];
    if (Math.abs(entry.signedOffset) > corridorLimit) continue;
    if (entry.gap > 0 && (!aheadEntry || entry.gap < aheadEntry.gap)) aheadEntry = entry;
  }
  const ahead = aheadEntry?.car;
  const aheadGap = aheadEntry?.gap ?? Infinity;
  const rearThreat = findDefensiveThreat(traffic, corridorLimit, car);
  const attackPlan = planAttackCommitment(car, ahead, traffic, trackLimit, aggression, aheadGap);

  let bestOffset = currentOffset;
  let bestScore = -Infinity;

  for (let laneIndex = 0; laneIndex < LANE_OFFSETS.length; laneIndex += 1) {
    const offset = clamp(LANE_OFFSETS[laneIndex], -trackLimit, trackLimit);
    const edgeClearance = trackLimit - Math.abs(offset);
    let score = 80;
    score -= Math.abs(offset - preferred) * 0.18;
    score -= Math.abs(offset - currentOffset) * (0.09 - aggression * 0.025);
    score -= Math.max(0, LANE_EDGE_CLEARANCE_TARGET - edgeClearance) * (0.92 - aggression * 0.42);

    for (let trafficIndex = 0; trafficIndex < traffic.length; trafficIndex += 1) {
      const entry = traffic[trafficIndex];
      // Separate pit/runoff traffic cannot be an overtaking opportunity or
      // defensive target. Keep it in the scan for genuine overlapping lanes.
      if (Math.abs(entry.signedOffset) > corridorLimit) continue;
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
    }

    if (ahead && aheadGap < TRAFFIC_GAP_AHEAD) {
      const passSide = attackPlan?.targetOffset ?? clamp(
        (mainTrackCenterOffset(ahead) * -0.65) + (car.index % 2 === 0 ? -1 : 1) * (PASS_SIDE_BASE + aggression * PASS_SIDE_AGGRESSION),
        -trackLimit,
        trackLimit,
      );
      const attackPressure = attackPlan?.pressure ?? 0.45;
      score -= Math.abs(offset - passSide) * (0.12 + aggression * 0.16) * attackPressure;
      if (attackPlan && Math.sign(offset || passSide) === attackPlan.side && Math.abs(offset - mainTrackCenterOffset(ahead)) > OVERTAKE_LATERAL_MIN) {
        score += metersToSimUnits(4 + aggression * 5) * attackPressure;
      }
    }

    const defenseIntensity = clamp((aggression - 0.5) / 0.3, 0, 1) *
      clamp((Math.max(riskTolerance, aggression) - 0.42) / 0.4, 0, 1);
    // A pass needs a stable lane; reactive defense must not steer across the
    // committed attacking line while the car is still passing its target.
    if (rearThreat && !attackPlan && defenseIntensity > 0.04) {
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
  }

  const laneChangeRate = metersToSimUnits(0.95 + car.racecraft * 0.32 + aggression * 0.78);
  car.desiredOffset = currentOffset + clamp(bestOffset - currentOffset, -laneChangeRate, laneChangeRate);

  const movement = laneMovementBounds(traffic, mainTrackCenterOffset(car));
  return {
    offset: car.desiredOffset,
    minimumOffset: movement.minimum,
    maximumOffset: movement.maximum,
    sameLaneAhead: findLaneTrafficAhead(traffic, car.desiredOffset, TRAFFIC_GAP_AHEAD),
    actualLaneAhead: findLaneTrafficAhead(traffic, mainTrackCenterOffset(car), TRAFFIC_GAP_AHEAD),
    sideRisk: findLaneTrafficBeside(traffic, car.desiredOffset),
    attackCommitted: Boolean(attackPlan),
    followingSpeed: followingSpeedFromTraffic(car, traffic),
  };
}

export function calculatePlannedTrafficPenalty(entry, plannedPassingOverlap) {
  return clamp(
    simUnitsToMeters(TRAFFIC_GAP_AHEAD - entry.gap) * (plannedPassingOverlap ? 0.08 : 0.16),
    0,
    plannedPassingOverlap ? 24 : 32,
  );
}

export function calculateActualOverlapPenalty(car, entry) {
  const gapMeters = simUnitsToMeters(entry.gap);
  const closingKph = Math.max(0, simSpeedToKph(car.speed - (entry.speed ?? car.speed)));
  const urgent = gapMeters < 12
    ? (12 - gapMeters) * (2.8 + closingKph * 0.04)
    : 0;

  return clamp(urgent, 0, 72);
}

export function planAttackCommitment(car, ahead, traffic, trackLimit, aggression, aheadGap = car.gapAhead) {
  const existingFrames = Math.max(0, Math.floor(car.attackCommitmentFrames ?? 0));
  const relativeSpeed = ahead ? car.speed - ahead.speed : 0;
  const closeEnough = ahead &&
    aheadGap > 0 &&
    aheadGap < OVERTAKE_GAP_BASE + aggression * OVERTAKE_GAP_AGGRESSION + metersToSimUnits(28);
  const speedPressure = clamp(relativeSpeed / kphToSimSpeed(34), -0.4, 1);

  if (closeEnough && speedPressure > -0.15) {
    const aheadOffset = mainTrackCenterOffset(ahead);
    const currentSide = Math.sign(car.attackSide ?? 0);
    const blockedCommitment = currentSide &&
      Math.sign(aheadOffset || currentSide) === currentSide &&
      Math.abs(aheadOffset - mainTrackCenterOffset(car)) < TRAFFIC_SIDE_GAP &&
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
    mainTrackCenterOffset(ahead) + side * (PASS_SIDE_BASE + aggression * PASS_SIDE_AGGRESSION + metersToSimUnits(2.4)),
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

export function chooseFreerAttackSide(traffic, preferredSide) {
  const sideScore = (side) => traffic.reduce((score, entry) => {
    if (entry.gap < -TRAFFIC_REAR_WINDOW || entry.gap > TRAFFIC_GAP_AHEAD) return score;
    const sameSide = Math.sign(entry.signedOffset || side) === side;
    return score - (sameSide ? 1 : 0) * (1 - clamp(Math.abs(entry.gap) / TRAFFIC_GAP_AHEAD, 0, 1));
  }, side === preferredSide ? 0.18 : 0);
  return sideScore(1) >= sideScore(-1) ? 1 : -1;
}

export function calculateRacingTrafficPenalty(car, lanePlan) {
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
