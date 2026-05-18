import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import { createRoute, routePoint } from './pitRouting.js';
import { PIT_QUEUE_RELEASE_SPEED } from './pitServiceConstants.js';
import { getPitBoxRaceDistance } from './pitOccupancy.js';

export function beginPitQueue(sim, car, box) {
  const stop = car.pitStop;
  if (!stop || !box?.queuePoint) return false;
  stop.status = 'queued';
  stop.phase = 'queue';
  stop.route = null;
  stop.routeProgress = 0;
  stop.queueingForService = false;
  car.x = box.queuePoint.x;
  car.y = box.queuePoint.y;
  car.heading = sim.track.pitLane.mainLane.heading;
  car.speed = 0;
  car.throttle = 0;
  car.brake = 1;
  applyWheelSurfaceState(car, sim.track);
  car.progress = car.trackState.distance;
  car.raceDistance = getPitBoxRaceDistance(sim, stop, {
    ...box,
    distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
  });
  return true;
}

export function releasePitQueue(sim, car, box, { fromCurrent = false } = {}) {
  const stop = car.pitStop;
  if (!stop || !box?.center) return false;
  const route = createRoute([
    ...(fromCurrent ? [routePoint(car, car.heading, { limiterActive: true })] : []),
    routePoint(box.queuePoint, sim.track.pitLane.mainLane.heading, { limiterActive: true }),
    routePoint(box.center, sim.track.pitLane.mainLane.heading, { limiterActive: true }),
  ]);
  stop.status = 'entering';
  stop.phase = 'queue-release';
  stop.queueingForService = false;
  stop.route = route;
  stop.routeProgress = 0;
  stop.routeStartRaceDistance = fromCurrent
    ? car.raceDistance ?? getPitBoxRaceDistance(sim, stop, {
        ...box,
        distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
      })
    : getPitBoxRaceDistance(sim, stop, {
        ...box,
        distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
      });
  stop.routeEndRaceDistance = getPitBoxRaceDistance(sim, stop, box);
  return true;
}

export { PIT_QUEUE_RELEASE_SPEED };
