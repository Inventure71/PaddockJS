import { REJOIN_HOLD_FRAMES } from './driverControlConstants.js';
import { createDriverInput } from './driverInput.js';
import { decideRacingControls } from './racingControls.js';
import { decideRejoinControls } from './rejoinControls.js';
import { shouldContinueRejoinRecovery } from './edgeRecovery.js';
import { decideSafetyCarControls } from './safetyCarControls.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';

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

  if (shouldStabilizeSimulatorCar(car, race)) {
    car.rejoinRecoveryFrames = Math.max(car.rejoinRecoveryFrames ?? 0, Math.floor(REJOIN_HOLD_FRAMES * 0.45));
    car.attackCommitmentFrames = 0;
    return decideRejoinControls(car, race);
  }

  if (shouldContinueRejoinRecovery(car, race)) {
    return decideRejoinControls(car, race);
  }

  return decideRacingControls(car, orderIndex, race);
}

function shouldStabilizeSimulatorCar(car, race) {
  if (race.physicsMode !== 'simulator') return false;
  const gripUsage = car.gripUsage ?? 0;
  const slipAngle = Math.abs(car.slipAngleRadians ?? 0);
  const edgeDistance = race.track.width / 2 - VEHICLE_LIMITS.carWidth * 2.25;
  const nearEdge = (car.trackState?.crossTrackError ?? 0) > edgeDistance;
  const unstable = car.stabilityState === 'spin-risk' || gripUsage > 1.25 || slipAngle > 0.24;
  return unstable && (nearEdge || slipAngle > 0.34 || gripUsage > 1.7);
}
