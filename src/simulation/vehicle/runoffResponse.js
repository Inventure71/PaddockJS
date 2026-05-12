import { VEHICLE_GEOMETRY, getVehicleGeometryState, vehicleAxes } from './vehicleGeometry.js';
import { applyWheelSurfaceState } from './wheelSurface.js';
import { nearestTrackStateForCar, pitOverrideAllowedForCar } from '../track/trackStatePolicy.js';
import { markCarDnf } from '../race/retirements.js';

export function applyRunoffResponseForSimulation(sim, car) {
  if (car.destroyed) {
    car.speed = 0;
    applyWheelSurfaceState(car, sim.track);
    return;
  }
  const allowPitOverride = pitOverrideAllowedForCar(car);
  const state = nearestTrackStateForCar(sim.track, car, car, car.progress, { allowPitOverride });
  const mainTrackState = state.inPitLane
    ? nearestTrackStateForCar(sim.track, car, car, car.progress, { allowPitOverride: false })
    : state;
  const barrierCenter = sim.track.width / 2 + (sim.track.kerbWidth ?? 0) + sim.track.gravelWidth + sim.track.runoffWidth;
  const signedLimit = barrierCenter - (sim.track.barrierWidth ?? 0) / 2;
  const side = Math.sign(mainTrackState.signedOffset) || 1;
  const outwardReach = getOutwardVehicleReach(car, mainTrackState, side);
  const overshoot = Math.abs(mainTrackState.signedOffset) + outwardReach - signedLimit;
  if (overshoot <= 0) {
    if (state.inPitLane) {
      applyWheelSurfaceState(car, sim.track, { centerState: state });
      return;
    }
    applyWheelSurfaceState(car, sim.track, { centerState: state });
    return;
  }

  destroyCarOnBarrier(sim, car);
  applyWheelSurfaceState(car, sim.track, { centerState: mainTrackState });
}

function getOutwardVehicleReach(car, state, side) {
  const visualReach = getVisualFootprintOutwardReach(car, state);
  const geometry = getVehicleGeometryState(car);
  let reach = visualReach;
  geometry.current.shapes.forEach((shape) => {
    shape.corners.forEach((corner) => {
      const lateral =
        (corner.x - car.x) * state.normalX +
        (corner.y - car.y) * state.normalY;
      reach = Math.max(reach, lateral * side);
    });
  });
  return reach;
}

function getVisualFootprintOutwardReach(car, state) {
  const axes = vehicleAxes(car.heading ?? 0);
  return (
    Math.abs(axes.forward.x * state.normalX + axes.forward.y * state.normalY) * VEHICLE_GEOMETRY.visualLength / 2 +
    Math.abs(axes.right.x * state.normalX + axes.right.y * state.normalY) * VEHICLE_GEOMETRY.visualWidth / 2
  );
}

function destroyCarOnBarrier(sim, car) {
  if (car.destroyed || car.finished) return;
  car.destroyed = true;
  car.destroyReason = 'barrier';
  car.destroyedAt = sim.time;
  car.outOfRace = true;
  markCarDnf(sim, car, { reason: 'barrier' });
  car.canAttack = false;
  car.drsActive = false;
  car.drsEligible = false;
  car.drsZoneId = null;
  car.drsZoneEnabled = false;
  car.speed = 0;
  car.throttle = 0;
  car.brake = 1;
  car.steeringAngle = 0;
  car.yawRate = 0;
  car.longitudinalAcceleration = 0;
  car.lateralAcceleration = 0;
  car.longitudinalG = 0;
  car.lateralG = 0;
  car.tractionLimited = false;
  car.stabilityState = 'destroyed';
  sim.events.unshift({
    type: 'car-destroyed',
    at: sim.time,
    carId: car.id,
    driverId: car.id,
    reason: 'barrier',
  });
}
