import { clamp, normalizeAngle } from '../simMath.js';
import { metersToSimUnits } from '../units.js';
import { pointAt } from '../track/trackModel.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';
import { REJOIN_LOOKAHEAD_BASE, REJOIN_LOOKAHEAD_MAX } from './driverControlConstants.js';

export function calculateTrackEdgeGuard(car, race) {
  const simulatorMode = race.physicsMode === 'simulator';
  const trackLimit = race.track.width / 2;
  const halfCarWidth = VEHICLE_LIMITS.carWidth / 2;
  const wholeCarOutsideLimit = trackLimit + halfCarWidth;
  const softLimit = trackLimit - halfCarWidth * (simulatorMode ? 3.0 : 1.9);
  const recoveryOffset = trackLimit - halfCarWidth * (simulatorMode ? 2.2 : 1.62);
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

export function shouldContinueRejoinRecovery(car, race) {
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
