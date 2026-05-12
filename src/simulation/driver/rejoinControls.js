import { clamp } from '../simMath.js';
import { kphToSimSpeed, simUnitsToMeters } from '../units.js';
import { offsetTrackPoint, pointAt } from '../track/trackModel.js';
import { REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_MAX } from './driverControlConstants.js';
import { angleToPoint } from './driverMath.js';
import { createDriverInput } from './driverInput.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';

export function decideRejoinControls(car, race) {
  if (race.physicsMode === 'simulator') {
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
    unsettledScale: () => 1,
  });
}

export function decideSimulatorRejoinControls(car, race) {
  return decideRejoinControlsForMode(car, race, {
    simulatorMode: true,
    inwardOffsetRatio: 0.24,
    surfaceTargetSpeeds: {
      track: 78,
      kerb: 58,
      gravel: 62,
      grass: 52,
      barrier: 22,
    },
    lowSpeedRecovery: {
      barrier: 0.42,
      default: 0.36,
    },
    throttleLimits: {
      barrier: 0.5,
      gravel: 0.82,
      grass: 0.76,
      default: 0.52,
    },
    brakeResponseKph: 24,
    onTrackBrakeLimit: 0.34,
    offTrackBrakeLimit: 0.24,
    steerGain: 0.94,
    unsettledScale: (entry) => clamp(
      1 - Math.max(0, (entry.gripUsage ?? 0) - 0.55) * 0.75 - Math.abs(entry.slipAngleRadians ?? 0) * 1.65,
      0.22,
      1,
    ),
  });
}

function decideRejoinControlsForMode(car, race, profile) {
  const simulatorMode = race.physicsMode === 'simulator';
  const lookahead = clamp(car.speed * (profile.simulatorMode ? 0.58 : 0.72) + REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_MAX);
  const distanceFromRoadMeters = simUnitsToMeters(Math.max(0, car.trackState.crossTrackError - race.track.width / 2));
  const targetBase = !car.trackState.onTrack && distanceFromRoadMeters > 2.5
    ? pointAt(race.track, car.progress)
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
  const recoveryThrottleFloor = profile.simulatorMode && !car.trackState.onTrack
    ? (car.trackState.surface === 'barrier' ? profile.lowSpeedRecovery.barrier : profile.lowSpeedRecovery.default)
    : lowSpeedRecovery;
  const throttleLimit = car.trackState.surface === 'barrier'
    ? profile.throttleLimits.barrier
    : car.trackState.surface === 'gravel'
      ? profile.throttleLimits.gravel
      : car.trackState.surface === 'grass'
        ? profile.throttleLimits.grass
        : profile.throttleLimits.default;
  const brakeAmount = speedError < -kphToSimSpeed(5)
    ? clamp(Math.abs(speedError) / kphToSimSpeed(profile.brakeResponseKph), 0.04, car.trackState.onTrack ? profile.onTrackBrakeLimit : profile.offTrackBrakeLimit)
    : 0;
  const unsettledScale = profile.unsettledScale(car);

  return createDriverInput()
    .steer(angleError * profile.steerGain)
    .accelerate(brakeAmount > 0.05 ? 0 : speedError > 0
      ? clamp(((speedError / kphToSimSpeed(24)) * alignment + recoveryThrottleFloor) * unsettledScale, 0.04, throttleLimit)
      : recoveryThrottleFloor * unsettledScale)
    .brake(brakeAmount)
    .controls();
}
