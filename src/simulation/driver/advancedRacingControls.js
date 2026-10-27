import { clamp } from '../simMath.js';
import { metersToSimUnits, simUnitsToMeters } from '../units.js';
import { pointAtInto } from '../track/trackModel.js';
import { VEHICLE_LIMITS, tirePerformanceFactor } from '../vehicle/vehiclePhysics.js';
import { advancedRaceTargetSpeed, advancedRacingSpeedControls } from './advancedRacePace.js';
import { advancedLateralAccelerationLimit } from '../vehicle/advancedTireForces.js';
import { mainTrackCenterOffset } from './trafficScan.js';
import { createDriverInput } from './driverInput.js';
import { advancedRacingPathCurvature, advancedRacingSteeringToPoint } from './advancedRacingSteering.js';
import { advancedRacingLookaheadMeters } from './advancedRacingTiming.js';
import { racingDriverProfile } from './racingDriverProfile.js';
import { planRacingLine, calculateRacingTrafficPenalty } from './racingLinePlan.js';

const TARGET_BASE_SCRATCH = { x: 0, y: 0, heading: 0, normalX: 0, normalY: 0, curvature: 0, distance: 0 };
const TARGET_POINT_SCRATCH = { x: 0, y: 0 };

export function decideAdvancedRacingControls(car, orderIndex, race) {
  const speed = simUnitsToMeters(car.speed);
  const profile = racingDriverProfile(car);
  const lane = planRacingLine(car, orderIndex, race);
  const lookahead = advancedRacingLookaheadMeters(speed);
  const target = pointAtInto(race.track, car.progress + metersToSimUnits(lookahead), TARGET_BASE_SCRATCH);
  const offsetLimit = race.track.width / 2 - VEHICLE_LIMITS.carWidth;
  const offset = clamp(
    clamp(advancedRacingOffset(car, lane.offset + metersToSimUnits(profile.lineErrorMeters), race.track.width, profile), lane.minimumOffset, lane.maximumOffset),
    -offsetLimit, offsetLimit,
  );
  TARGET_POINT_SCRATCH.x = target.x + target.normalX * offset;
  TARGET_POINT_SCRATCH.y = target.y + target.normalY * offset;
  const pathCurvature = advancedRacingPathCurvature(car, TARGET_POINT_SCRATCH);

  let targetSpeed = advancedRaceTargetSpeed(car, race.track, pathCurvature, profile);
  const trafficPenalty = calculateRacingTrafficPenalty(car, lane) * (1 - (car.aggression ?? 0.5) * 0.28);
  targetSpeed = Math.max(0, targetSpeed - trafficPenalty / 3.6);
  // A passing intention does not create physical clearance. Match a slower
  // car until the actual footprints separate, including enough reaction gap.
  targetSpeed = Math.min(targetSpeed, lane.followingSpeed);
  const { throttle, brake } = advancedRacingSpeedControls(car, targetSpeed, profile);
  const { steering } = advancedRacingSteeringToPoint(car, TARGET_POINT_SCRATCH, profile, { throttle, brake });
  return createDriverInput().steer(steering).accelerate(throttle).brake(brake).controls();
}

export function advancedRacingOffset(car, plannedOffset, trackWidth, profile = racingDriverProfile(car)) {
  const speed = simUnitsToMeters(car.speed);
  const capacity = advancedLateralAccelerationLimit(car, speed, tirePerformanceFactor(car.tireEnergy ?? 100));
  const cornerUsage = clamp(Math.abs(speed * (car.yawRate ?? 0)) / (capacity * profile.lateralShare * 0.9), 0, 1);
  const currentOffset = mainTrackCenterOffset(car);
  // Hold a consistent line when cornering consumes the racing grip budget.
  // As the car unwinds on exit, progressively allow the planned lane change.
  const comfortLimit = Math.max(0, trackWidth / 2 - VEHICLE_LIMITS.carWidth * 2);
  const edgePressure = clamp((Math.abs(currentOffset) - comfortLimit) / VEHICLE_LIMITS.carWidth, 0, 1);
  const needsEdgeCorrection = cornerUsage > 0.5 && edgePressure > 0;
  if (needsEdgeCorrection) {
    // Holding a loaded corner line must not preserve a developing excursion.
    // Correct inward on the current side before considering a cross-track pass.
    plannedOffset = Math.sign(currentOffset) * Math.min(Math.abs(plannedOffset), comfortLimit);
  }
  const laneChangeShare = Math.max(1 - cornerUsage ** 2, needsEdgeCorrection ? edgePressure : 0);
  const offsetLimit = trackWidth / 2 - VEHICLE_LIMITS.carWidth;
  return clamp(currentOffset + (plannedOffset - currentOffset) * laneChangeShare, -offsetLimit, offsetLimit);
}
