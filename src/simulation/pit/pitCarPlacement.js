import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import { syncPitCarKinematics } from './pitKinematics.js';
import { getPitBoxRaceDistance } from './pitOccupancy.js';

// Pit control owns this pose while a car waits or receives stationary service.
export function holdPitCarAtBox(sim, car, box, { queue = false, updatePreviousPose = false } = {}) {
  if (updatePreviousPose) {
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
  }
  const position = queue ? box.queuePoint : box.center;
  car.x = position.x;
  car.y = position.y;
  car.heading = sim.track.pitLane.mainLane.heading;
  car.speed = 0;
  car.throttle = 0;
  car.brake = 1;
  car.steeringAngle = 0;
  car.yawRate = 0;
  car.turnRadius = Infinity;
  syncPitCarKinematics(car, { physicsMode: sim.physicsMode });
  applyWheelSurfaceState(car, sim.track);
  car.progress = car.trackState.distance;
  car.raceDistance = getPitBoxRaceDistance(sim, car.pitStop, queue ? {
    ...box,
    distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
  } : box);
}
