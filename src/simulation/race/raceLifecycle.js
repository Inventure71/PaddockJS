import { offsetTrackPoint, pointAt } from '../track/trackModel.js';
import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import { clamp } from '../simMath.js';
import { nearestTrackStateForCar } from '../track/trackStatePolicy.js';

export function setPitLaneOpenState(sim, open) {
  const next = Boolean(open);
  if (next === Boolean(sim.raceControl.pitLaneOpen)) return;
  sim.raceControl.pitLaneOpen = next;
  sim.events.unshift({ type: next ? 'pit-lane-open' : 'pit-lane-closed', at: sim.time });
}

export function updateStartSequence(sim) {
  const start = sim.raceControl.start;
  if (sim.raceControl.mode !== 'pre-start' || !start || start.released) return;

  if (sim.time >= start.lightsOutAt) {
    releaseRaceStart(sim);
    sim.events.unshift({ type: 'start-lights-out', at: sim.time });
    return;
  }

  start.lightsLit = clamp(
    Math.floor((sim.time + Number.EPSILON) / sim.rules.startLightInterval),
    0,
    start.lightCount,
  );
}

export function releaseRaceStart(sim) {
  const start = sim.raceControl.start;
  sim.raceControl.mode = 'green';
  start.lightsLit = 0;
  start.released = true;
  start.releasedAt = sim.time;
  sim.cars.forEach((car) => {
    const wasGridLocked = car.gridLocked;
    car.gridLocked = false;
    const state = nearestTrackStateForCar(sim.track, car, car, car.gridDistance);
    car.progress = state.distance;
    applyWheelSurfaceState(car, sim.track);
    if (wasGridLocked) car.raceDistance = car.gridDistance;
    if (wasGridLocked) car.desiredOffset = 0;
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
  });
}

export function holdGridCars(sim) {
  sim.cars.forEach((car) => {
    if (!car.gridLocked) return;
    const gridPoint = pointAt(sim.track, car.gridDistance);
    const position = offsetTrackPoint(gridPoint, car.gridOffset);
    car.previousX = position.x;
    car.previousY = position.y;
    car.previousHeading = gridPoint.heading;
    car.x = position.x;
    car.y = position.y;
    car.heading = gridPoint.heading;
    car.speed = 0;
    car.throttle = 0;
    car.brake = 1;
    car.steeringAngle = 0;
    car.yawRate = 0;
    car.turnRadius = Infinity;
    car.progress = gridPoint.distance;
    car.raceDistance = car.gridDistance;
    applyWheelSurfaceState(car, sim.track);
  });
}
