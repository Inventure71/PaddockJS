import { clamp } from '../simMath.js';
import { kphToSimSpeed, simUnitsToMeters } from '../units.js';
import { offsetTrackPoint, pointAt } from '../track/trackModel.js';
import { REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_MAX } from './driverControlConstants.js';
import { angleToPoint } from './driverMath.js';
import { createDriverInput } from './driverInput.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';

export function decideRejoinControls(car, race) {
  const simulatorMode = race.physicsMode === 'simulator';
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
    ? -signedSide * race.track.width * (simulatorMode ? 0.28 : 0.34)
    : 0;
  const target = offsetTrackPoint(targetBase, rejoinOffset);
  const angleError = angleToPoint(car, target);
  const surfaceTargetSpeedKph = car.trackState.surface === 'track'
    ? simulatorMode ? 74 : 88
    : car.trackState.surface === 'kerb'
      ? simulatorMode ? 52 : 72
      : car.trackState.surface === 'gravel'
        ? simulatorMode ? 34 : 56
        : car.trackState.surface === 'grass'
          ? simulatorMode ? 30 : 48
          : simulatorMode ? 18 : 34;
  const alignment = clamp(1 - Math.abs(angleError) / Math.PI, 0.22, 1);
  const desiredSpeed = kphToSimSpeed(clamp(
    surfaceTargetSpeedKph * (0.62 + alignment * 0.38) - distanceFromRoadMeters * 0.065,
    car.trackState.surface === 'barrier' ? 12 : 24,
    surfaceTargetSpeedKph,
  ));
  const speedError = desiredSpeed - car.speed;
  const lowSpeedRecovery = car.speed < kphToSimSpeed(18)
    ? car.trackState.surface === 'barrier' ? simulatorMode ? 0.22 : 0.34 : simulatorMode ? 0.12 : 0.18
    : 0;
  const throttleLimit = car.trackState.surface === 'barrier'
    ? simulatorMode ? 0.32 : 0.68
    : car.trackState.surface === 'gravel'
      ? simulatorMode ? 0.28 : 0.46
      : car.trackState.surface === 'grass'
        ? simulatorMode ? 0.24 : 0.42
        : simulatorMode ? 0.34 : 0.42;
  const brakeAmount = speedError < -kphToSimSpeed(5)
    ? clamp(Math.abs(speedError) / kphToSimSpeed(simulatorMode ? 22 : 30), 0.04, car.trackState.onTrack ? simulatorMode ? 0.34 : 0.46 : simulatorMode ? 0.48 : 0.74)
    : 0;
  const unsettledScale = simulatorMode
    ? clamp(1 - Math.max(0, (car.gripUsage ?? 0) - 0.55) * 0.9 - Math.abs(car.slipAngleRadians ?? 0) * 2.2, 0.15, 1)
    : 1;

  return createDriverInput()
    .steer(angleError * (simulatorMode ? 1.12 : 1.65))
    .accelerate(brakeAmount > 0.05 ? 0 : speedError > 0
      ? clamp(((speedError / kphToSimSpeed(24)) * alignment + lowSpeedRecovery) * unsettledScale, 0.04, throttleLimit)
      : lowSpeedRecovery)
    .brake(brakeAmount)
    .controls();
}
