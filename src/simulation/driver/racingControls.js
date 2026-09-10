import { isSimulatorPhysicsMode } from '../vehicle/vehiclePhysics.js';
import { decideArcadeRacingControls } from './arcadeRacingControls.js';
import { decideAdvancedRacingControls } from './advancedRacingControls.js';

export { decideArcadeRacingControls } from './arcadeRacingControls.js';
export { decideAdvancedRacingControls as decideSimulatorRacingControls } from './advancedRacingControls.js';
export { calculateRacingLineOffset, maxLookaheadCurvature } from './arcadeRacePace.js';

export function decideRacingControls(car, orderIndex, race) {
  return isSimulatorPhysicsMode(race.physicsMode)
    ? decideAdvancedRacingControls(car, orderIndex, race)
    : decideArcadeRacingControls(car, orderIndex, race);
}
