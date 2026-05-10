import { REJOIN_HOLD_FRAMES } from './driverControlConstants.js';
import { createDriverInput } from './driverInput.js';
import { decideRacingControls } from './racingControls.js';
import { decideRejoinControls } from './rejoinControls.js';
import { shouldContinueRejoinRecovery } from './edgeRecovery.js';
import { decideSafetyCarControls } from './safetyCarControls.js';

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
