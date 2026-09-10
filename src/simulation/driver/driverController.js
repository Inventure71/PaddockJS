import { REJOIN_HOLD_FRAMES } from './driverControlConstants.js';
import { createDriverInput } from './driverInput.js';
import { decideRacingControls } from './racingControls.js';
import { decideRejoinControls } from './rejoinControls.js';
import { shouldContinueRejoinRecovery } from './edgeRecovery.js';
import { decideSafetyCarControls } from './safetyCarControls.js';
import { VEHICLE_LIMITS, isSimulatorPhysicsMode } from '../vehicle/vehiclePhysics.js';
import { normalizeAngle } from '../simMath.js';

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

  // Forward path pursuit is ambiguous when the car faces away from the road.
  // Let the existing recovery controller turn it around before resuming pace.
  if (!isSimulatorPhysicsMode(race.physicsMode) &&
      Math.abs(normalizeAngle(car.heading - car.trackState.heading)) > Math.PI / 2) {
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
  if (!isSimulatorPhysicsMode(race.physicsMode)) return false;
  const slipAngle = Math.abs(car.slipAngleRadians ?? 0);
  const edgeDistance = race.track.width / 2 - VEHICLE_LIMITS.carWidth * 2.25;
  const nearEdge = (car.trackState?.crossTrackError ?? 0) > edgeDistance;
  // Tire force demand can exceed capacity during a straight launch. Recovery
  // responds to lost directional stability, not longitudinal demand alone.
  const unstable = car.stabilityState === 'spin-risk' || slipAngle > 0.24;
  return unstable && (nearEdge || slipAngle > 0.34);
}
