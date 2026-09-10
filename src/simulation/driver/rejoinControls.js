import { clamp } from '../simMath.js';
import { kphToSimSpeed, simUnitsToMeters, metersToSimUnits } from '../units.js';
import { offsetTrackPoint, pointAt } from '../track/trackModel.js';
import { REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_MAX } from './driverControlConstants.js';
import { angleToPoint } from './driverMath.js';
import { createDriverInput } from './driverInput.js';
import { VEHICLE_LIMITS, isSimulatorPhysicsMode, tirePerformanceFactor } from '../vehicle/vehiclePhysics.js';
import { advancedLateralAccelerationLimit } from '../vehicle/advancedTireForces.js';
import { advancedSteeringToPoint, advancedSpeedControls } from './advancedPathControls.js';
import { analyzeTrackEdgeMotion } from './recoveryDynamics.js';

export function decideRejoinControls(car, race) {
  if (isSimulatorPhysicsMode(race.physicsMode)) {
    return decideSimulatorRejoinControls(car, race);
  }
  return decideArcadeRejoinControls(car, race);
}

export function decideArcadeRejoinControls(car, race) {
  return decideRejoinControlsForMode(car, race, {
    simulatorMode: false,
    inwardOffsetRatio: 0.34,
    surfaceTargetSpeeds: {
      track: 88,
      kerb: 72,
      gravel: 56,
      grass: 48,
      barrier: 34,
    },
    lowSpeedRecovery: {
      barrier: 0.34,
      default: 0.18,
    },
    throttleLimits: {
      barrier: 0.68,
      gravel: 0.46,
      grass: 0.42,
      default: 0.42,
    },
    brakeResponseKph: 30,
    onTrackBrakeLimit: 0.46,
    offTrackBrakeLimit: 0.74,
    steerGain: 1.65,
    outwardBrakeStartMps: 1.2,
    outwardBrakeGain: 0.08,
    misalignmentBrakeGain: 0.06,
    slideThrottleDamping: 0.36,
    offTrackForwardTargetScale: 0.42,
    lowSpeedForwardTargetScale: 0,
    lowSpeedOffTrackSteerLimit: 0.52,
    lowSpeedRecoveryThrottle: 0.32,
    lowSpeedOutwardBrakeStartMps: 1.2,
    lowSpeedCrawlOutwardToleranceMps: 0,
    lowSpeedHeadingOutwardThrottleLimit: 1,
    stabilizeLowSpeedOutward: false,
    stabilizeRejoinHoldOutsideRoad: false,
    unsettledScale: () => 1,
  });
}

export function decideSimulatorRejoinControls(car, race) {
  const speed = simUnitsToMeters(car.speed);
  if (Math.abs(car.slipAngleRadians ?? 0) > 0.5 && speed > 2) {
    // Once the car is sliding sideways/backwards, path steering cannot recover
    // its line. Arrest the slide before requesting a forward rejoin.
    return createDriverInput().brake(1).controls();
  }
  const target = pointAt(race.track, car.progress + metersToSimUnits(clamp(10 + speed * 0.5, 10, 30)));
  const { steering, curvature } = advancedSteeringToPoint(car, target);
  const capacity = advancedLateralAccelerationLimit(car, speed, tirePerformanceFactor(car.tireEnergy ?? 100));
  const surfaceSpeed = car.trackState.onTrack ? 22 : 12;
  const targetSpeed = Math.min(surfaceSpeed, Math.sqrt(capacity * 0.55 / Math.max(Math.abs(curvature), 0.001)));
  const { throttle, brake } = advancedSpeedControls(car, targetSpeed);
  return createDriverInput().steer(steering).accelerate(throttle).brake(brake).controls();
}

function decideRejoinControlsForMode(car, race, profile) {
  const lookahead = clamp(car.speed * (profile.simulatorMode ? 0.58 : 0.72) + REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_MAX);
  const edgeMotion = analyzeTrackEdgeMotion(car, race);
  const lowSpeedOffTrack = !car.trackState.onTrack && car.speed < kphToSimSpeed(24);
  const distanceFromRoadMeters = simUnitsToMeters(Math.max(0, car.trackState.crossTrackError - race.track.width / 2));
  const inRejoinHold = (car.rejoinRecoveryFrames ?? 0) > 0;
  const recoveringOutsideRoad = distanceFromRoadMeters > 0.25 &&
    (!car.trackState.onTrack || (profile.stabilizeRejoinHoldOutsideRoad && inRejoinHold));
  const offTrackTargetScale = lowSpeedOffTrack
    ? profile.lowSpeedForwardTargetScale
    : profile.offTrackForwardTargetScale;
  const targetBase = !car.trackState.onTrack && distanceFromRoadMeters > 2.5
    ? pointAt(race.track, car.progress + lookahead * offTrackTargetScale)
    : pointAt(race.track, car.progress + lookahead * 0.78);
  const signedSide = Math.sign(car.trackState?.signedOffset ?? 0);
  const rejoinOffset = signedSide !== 0 && (
    distanceFromRoadMeters > 0.5 ||
    car.trackState.crossTrackError > race.track.width / 2 - VEHICLE_LIMITS.carWidth * 1.6
  )
    ? -signedSide * race.track.width * profile.inwardOffsetRatio
    : 0;
  const target = offsetTrackPoint(targetBase, rejoinOffset);
  const angleError = angleToPoint(car, target);
  const surfaceTargetSpeedKph = car.trackState.surface === 'track'
    ? profile.surfaceTargetSpeeds.track
    : car.trackState.surface === 'kerb'
      ? profile.surfaceTargetSpeeds.kerb
      : car.trackState.surface === 'gravel'
        ? profile.surfaceTargetSpeeds.gravel
        : car.trackState.surface === 'grass'
          ? profile.surfaceTargetSpeeds.grass
          : profile.surfaceTargetSpeeds.barrier;
  const alignment = clamp(1 - Math.abs(angleError) / Math.PI, 0.22, 1);
  const desiredSpeed = kphToSimSpeed(clamp(
    surfaceTargetSpeedKph * (0.62 + alignment * 0.38) - distanceFromRoadMeters * 0.065,
    car.trackState.surface === 'barrier' ? 12 : 24,
    surfaceTargetSpeedKph,
  ));
  const speedError = desiredSpeed - car.speed;
  const lowSpeedRecovery = car.speed < kphToSimSpeed(18)
    ? car.trackState.surface === 'barrier' ? profile.lowSpeedRecovery.barrier : profile.lowSpeedRecovery.default
    : 0;
  const outwardBrakeStart = lowSpeedOffTrack
    ? profile.lowSpeedOutwardBrakeStartMps
    : profile.outwardBrakeStartMps;
  const canCrawlSteerRecovery = lowSpeedOffTrack &&
    car.speed < kphToSimSpeed(8) &&
    edgeMotion.outwardSpeedMps < profile.lowSpeedCrawlOutwardToleranceMps;
  const needsOutwardStabilization = recoveringOutsideRoad &&
    (!lowSpeedOffTrack || profile.stabilizeLowSpeedOutward) &&
    !canCrawlSteerRecovery &&
    edgeMotion.outwardSpeedMps > outwardBrakeStart &&
    distanceFromRoadMeters > 0.25;
  const recoveryThrottleFloorBase = profile.simulatorMode && !car.trackState.onTrack
    ? (car.trackState.surface === 'barrier' ? profile.lowSpeedRecovery.barrier : profile.lowSpeedRecovery.default)
    : lowSpeedRecovery;
  const lowSpeedRecoveryThrottle = lowSpeedOffTrack && car.trackState.surface !== 'barrier'
    ? profile.lowSpeedRecoveryThrottle
    : 0;
  const recoveryThrottleFloor = needsOutwardStabilization
    ? 0
    : Math.max(recoveryThrottleFloorBase, lowSpeedRecoveryThrottle);
  const surfaceThrottleLimit = car.trackState.surface === 'barrier'
    ? profile.throttleLimits.barrier
    : car.trackState.surface === 'gravel'
      ? profile.throttleLimits.gravel
      : car.trackState.surface === 'grass'
        ? profile.throttleLimits.grass
        : profile.throttleLimits.default;
  const throttleLimit = lowSpeedOffTrack && edgeMotion.headingOutward && distanceFromRoadMeters > 0.5
    ? Math.min(surfaceThrottleLimit, profile.lowSpeedHeadingOutwardThrottleLimit)
    : surfaceThrottleLimit;
  let brakeAmount = speedError < -kphToSimSpeed(5)
    ? clamp(Math.abs(speedError) / kphToSimSpeed(profile.brakeResponseKph), 0.04, car.trackState.onTrack ? profile.onTrackBrakeLimit : profile.offTrackBrakeLimit)
    : 0;
  if (needsOutwardStabilization) {
    brakeAmount = Math.max(
      brakeAmount,
      clamp(
        (edgeMotion.outwardSpeedMps - outwardBrakeStart) * profile.outwardBrakeGain +
          Math.max(0, Math.abs(angleError) - 1.05) * profile.misalignmentBrakeGain,
        0,
        car.trackState.onTrack ? profile.onTrackBrakeLimit : profile.offTrackBrakeLimit,
      ),
    );
  }
  const unsettledScale = lowSpeedOffTrack
    ? Math.max(profile.unsettledScale(car), 0.82)
    : profile.unsettledScale(car);
  const slideThrottleScale = 1 - clamp(
    Math.max(0, edgeMotion.outwardSpeedMps - profile.outwardBrakeStartMps) * profile.slideThrottleDamping +
      Math.max(0, Math.abs(angleError) - 1.25) * 0.22,
    0,
    0.94,
  );
  const steeringRequest = lowSpeedOffTrack
    ? clamp(angleError * profile.steerGain, -profile.lowSpeedOffTrackSteerLimit, profile.lowSpeedOffTrackSteerLimit)
    : angleError * profile.steerGain;
  const minimumAcceleration = needsOutwardStabilization ? 0 : 0.04;

  return createDriverInput()
    .steer(steeringRequest)
    .accelerate(brakeAmount > 0.05 ? 0 : speedError > 0
      ? clamp(((speedError / kphToSimSpeed(24)) * alignment + recoveryThrottleFloor) * unsettledScale * slideThrottleScale, minimumAcceleration, throttleLimit)
      : recoveryThrottleFloor * unsettledScale * slideThrottleScale)
    .brake(brakeAmount)
    .controls();
}
