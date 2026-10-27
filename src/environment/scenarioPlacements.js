import { normalizeAngle } from '../simulation/simMath.js';
import { offsetTrackPoint, pointAt } from '../simulation/track/trackModel.js';
import { kphToSimSpeed, metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';

export function applyEnvironmentPlacements(sim, track, carsById, placements = {}) {
  const states = {};
  Object.entries(placements).forEach(([driverId, placement]) => {
    const currentCar = carsById.get(driverId);
    if (!currentCar) return;
    states[driverId] = placementToCarState(track, currentCar, placement, {
      physicsMode: sim.physicsMode,
    });
  });
  if (typeof sim.setCarStates === 'function') {
    sim.setCarStates(states);
    return;
  }
  Object.entries(states).forEach(([driverId, partial]) => {
    sim.setCarState(driverId, partial);
  });
}

function placementToCarState(track, currentCar, placement, { physicsMode = 'arcade' } = {}) {
  const currentDistanceMeters = currentCar.distanceMeters ?? simUnitsToMeters(currentCar.raceDistance ?? currentCar.progress ?? 0);
  const raceDistance = metersToSimUnits(Math.max(0, placement.distanceMeters ?? currentDistanceMeters));
  const offset = metersToSimUnits(placement.offsetMeters ?? 0);
  const base = pointAt(track, raceDistance);
  const position = offsetTrackPoint(base, offset);
  const heading = normalizeAngle(base.heading + (placement.headingErrorRadians ?? 0));
  const speed = placement.speedKph == null ? null : kphToSimSpeed(placement.speedKph);
  const partial = {
    x: position.x,
    y: position.y,
    previousX: position.x,
    previousY: position.y,
    progress: base.distance,
    raceDistance,
    desiredOffset: offset,
    heading,
    previousHeading: heading,
    destroyed: false,
    destroyReason: null,
    destroyedAt: null,
    outOfRace: false,
    canAttack: true,
    throttle: 0,
    brake: 0,
    longitudinalAcceleration: 0,
    lateralAcceleration: 0,
    lateralG: 0,
    longitudinalG: 0,
    gripUsage: 0,
    slipAngleRadians: 0,
    tractionLimited: false,
    steeringAngle: 0,
    yawRate: 0,
    stabilityState: 'stable',
  };
  if (speed != null) {
    partial.speed = speed;
    if (physicsMode === 'advanced') {
      partial.velocityX = Math.cos(heading) * speed;
      partial.velocityY = Math.sin(heading) * speed;
    } else {
      partial.velocityX = null;
      partial.velocityY = null;
    }
  }
  return partial;
}
