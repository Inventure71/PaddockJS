import { kphToSimSpeed } from '../units.js';
import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import {
  createRoute,
  pitDriveLaneOffset,
  pitMainLanePointAt,
  routePoint,
} from './pitRouting.js';
import { getPitBoxRaceDistance, getPitStopBox } from './pitOccupancy.js';
import { calculatePitServiceProfile } from './pitServiceProfile.js';
import { PIT_BOX_APPROACH_DISTANCE, PIT_EXIT_RELEASE_SPEED_KPH } from './pitServiceConstants.js';

export function beginTireService(sim, car) {
  const stop = car.pitStop;
  if (!stop) return;
  const serviceProfile = calculatePitServiceProfile(sim, car);
  stop.phase = 'service';
  stop.penaltyServiceRemaining = 0;
  stop.serviceProfile = serviceProfile;
  stop.serviceRemaining = serviceProfile.seconds;
  sim.events.unshift({
    type: 'pit-stop-start',
    at: sim.time,
    carId: car.id,
    boxId: stop.boxId,
    teamId: stop.teamId ?? null,
    targetTire: stop.targetTire,
    serviceSeconds: serviceProfile.seconds,
    serviceIssue: serviceProfile.issue,
  });
}

export function completePitService(sim, car) {
  const stop = car.pitStop;
  const box = getPitStopBox(sim, stop);
  const pitLane = sim.track.pitLane;
  if (!stop || !box || !pitLane?.enabled) return;

  car.tire = stop.targetTire ?? car.tire;
  car.tireEnergy = 100;
  if (car.tire && !car.usedTireCompounds.includes(car.tire)) car.usedTireCompounds.push(car.tire);
  sim.events.unshift({
    type: 'pit-stop-complete',
    at: sim.time,
    carId: car.id,
    boxId: box.id,
    teamId: box.teamId ?? null,
    tire: car.tire,
  });

  const driveLaneOffset = pitDriveLaneOffset(pitLane);
  const boxReleaseDistance = Math.min(pitLane.mainLane.length, box.distanceAlongLane + PIT_BOX_APPROACH_DISTANCE);
  const route = createRoute([
    routePoint(box.center, pitLane.mainLane.heading, { limiterActive: true }),
    routePoint(box.laneTarget, pitLane.mainLane.heading, { limiterActive: true }),
    routePoint(pitMainLanePointAt(pitLane, boxReleaseDistance, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
    routePoint(pitMainLanePointAt(pitLane, pitLane.mainLane.length, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
    ...(pitLane.exit.roadCenterline ?? []).map((point) => routePoint(point)),
  ]);
  stop.status = 'exiting';
  stop.phase = 'exit';
  stop.route = route;
  stop.routeProgress = 0;
  stop.routeStartRaceDistance = getPitBoxRaceDistance(sim, stop, box);
  stop.routeEndRaceDistance = stop.lapBase + pitLane.exit.distanceFromStart;
}

export function finishPitExit(sim, car) {
  const stop = car.pitStop;
  if (!stop) return;
  stop.status = 'completed';
  stop.phase = null;
  stop.route = null;
  stop.routeProgress = 0;
  stop.serviceRemaining = 0;
  stop.queueingForService = false;
  stop.stopsCompleted = (stop.stopsCompleted ?? 0) + 1;
  stop.intent = 0;
  car.speed = Math.max(car.speed, kphToSimSpeed(PIT_EXIT_RELEASE_SPEED_KPH));
  car.throttle = 0.55;
  car.brake = 0;
  applyWheelSurfaceState(car, sim.track);
  car.progress = car.trackState.distance;
  car.raceDistance = Math.max(car.raceDistance ?? 0, stop.routeEndRaceDistance ?? car.raceDistance ?? 0);
  sim.events.unshift({
    type: 'pit-exit',
    at: sim.time,
    carId: car.id,
    boxId: stop.boxId,
    teamId: stop.teamId ?? null,
  });
}
