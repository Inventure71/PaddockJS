import { clamp } from '../simMath.js';
import { metersToSimUnits, simUnitsToMeters } from '../units.js';
import { pointAt } from '../track/trackModel.js';
import { VEHICLE_LIMITS, tirePerformanceFactor } from '../vehicle/vehiclePhysics.js';
import { advancedRaceTargetSpeed, advancedRacingSpeedControls, advancedFollowingSpeed, ADVANCED_RACING_GRIP_SHARE } from './advancedRacePace.js';
import { advancedLateralAccelerationLimit } from '../vehicle/advancedTireForces.js';
import { signedLateralOffsetToPoint } from '../track/trackMath.js';
import { createDriverInput } from './driverInput.js';
import { advancedSteeringToPoint } from './advancedPathControls.js';
import { planRacingLine, calculateActualOverlapPenalty, calculatePlannedTrafficPenalty } from './racingLinePlan.js';
import { OVERTAKE_LATERAL_MIN, TRAFFIC_SIDE_GAP } from './driverControlConstants.js';

export function decideAdvancedRacingControls(car, orderIndex, race) {
  const speed = simUnitsToMeters(car.speed);
  const lane = planRacingLine(car, orderIndex, race);
  const lookahead = clamp(12 + speed * 0.65, 12, 55);
  const target = pointAt(race.track, car.progress + metersToSimUnits(lookahead));
  const offset = advancedRacingOffset(car, lane.offset, race.track.width);
  const { steering, curvature: pathCurvature } = advancedSteeringToPoint(car, {
    x: target.x + target.normalX * offset,
    y: target.y + target.normalY * offset,
  });

  let targetSpeed = advancedRaceTargetSpeed(car, race.track, pathCurvature);
  const plannedPassingOverlap = lane.attackCommitted && lane.sameLaneAhead &&
    Math.abs(lane.sameLaneAhead.signedOffset - (car.trackState.signedOffset ?? 0)) > OVERTAKE_LATERAL_MIN;
  const actualLaneLateral = lane.actualLaneAhead
    ? Math.abs(lane.actualLaneAhead.signedOffset - (car.trackState.signedOffset ?? 0))
    : Infinity;
  const trafficPenalty = Math.max(
    lane.sameLaneAhead ? calculatePlannedTrafficPenalty(lane.sameLaneAhead, plannedPassingOverlap) : 0,
    lane.actualLaneAhead && actualLaneLateral < OVERTAKE_LATERAL_MIN
      ? calculateActualOverlapPenalty(car, lane.actualLaneAhead) : 0,
    lane.sideRisk ? clamp(simUnitsToMeters(TRAFFIC_SIDE_GAP - lane.sideRisk.lateral) * 0.78, 0, 30) : 0,
  ) * (1 - (car.aggression ?? 0.5) * 0.28);
  targetSpeed = Math.max(8, targetSpeed - trafficPenalty / 3.6);
  // A passing intention does not create physical clearance. Match a slower
  // car until the actual footprints separate, including enough reaction gap.
  targetSpeed = Math.min(targetSpeed, advancedFollowingSpeed(car, race.cars));
  const { throttle, brake } = advancedRacingSpeedControls(car, targetSpeed);
  return createDriverInput().steer(steering).accelerate(throttle).brake(brake).controls();
}

export function advancedRacingOffset(car, plannedOffset, trackWidth) {
  const speed = simUnitsToMeters(car.speed);
  const capacity = advancedLateralAccelerationLimit(car, speed, tirePerformanceFactor(car.tireEnergy ?? 100));
  const cornerUsage = clamp(Math.abs(speed * (car.yawRate ?? 0)) / (capacity * ADVANCED_RACING_GRIP_SHARE), 0, 1);
  const currentOffset = car.trackState.mainTrackSignedOffset ?? signedLateralOffsetToPoint(car.trackState, car);
  // Hold a consistent line when cornering consumes the racing grip budget.
  // As the car unwinds on exit, progressively allow the planned lane change.
  const laneChangeShare = 1 - cornerUsage ** 2;
  const offsetLimit = trackWidth / 2 - VEHICLE_LIMITS.carWidth;
  return clamp(currentOffset + (plannedOffset - currentOffset) * laneChangeShare, -offsetLimit, offsetLimit);
}
