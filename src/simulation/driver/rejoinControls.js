import { clamp } from '../simMath.js';
import { kphToSimSpeed, simUnitsToMeters } from '../units.js';
import { offsetTrackPoint, pointAt } from '../track/trackModel.js';
import { REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_MAX } from './driverControlConstants.js';
import { angleToPoint } from './driverMath.js';
import { createDriverInput } from './driverInput.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';

export function decideRejoinControls(car, race) {
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
