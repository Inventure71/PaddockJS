import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import { normalizePitCrewStats } from './pitState.js';
import { beginPitPenaltyService } from './pitPenaltyService.js';
import { beginTireService } from './pitTireService.js';
import { getPitBoxRaceDistance } from './pitOccupancy.js';

export { normalizePitCrewStats };
export {
  getPitBoxRaceDistance,
  getPitStopBox,
  isPitServiceAreaOccupied,
  isPitServiceBusy,
  isPitServiceQueueOccupied,
} from './pitOccupancy.js';
export { beginPitQueue, releasePitQueue } from './pitQueue.js';
export { calculatePitServiceProfile } from './pitServiceProfile.js';
export { beginPitPenaltyService, completePitPenaltyService, getPitServicePenalties } from './pitPenaltyService.js';
export { beginTireService, completePitService, finishPitExit } from './pitTireService.js';
export { advancePitService, applyPitRoutePosition } from './pitRouteMovement.js';

export function beginPitService(sim, car, box) {
  const stop = car.pitStop;
  stop.status = 'servicing';
  stop.route = null;
  stop.routeProgress = 0;
  car.x = box.center.x;
  car.y = box.center.y;
  car.heading = sim.track.pitLane.mainLane.heading;
  car.speed = 0;
  car.throttle = 0;
  car.brake = 1;
  car.steeringAngle = 0;
  car.yawRate = 0;
  car.turnRadius = Infinity;
  applyWheelSurfaceState(car, sim.track);
  car.progress = car.trackState.distance;
  car.raceDistance = getPitBoxRaceDistance(sim, stop, box);

  if (beginPitPenaltyService(sim, car)) return;
  beginTireService(sim, car);
}
