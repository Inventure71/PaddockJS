import {
  VEHICLE_GEOMETRY,
  vehicleAxes,
} from './vehicleGeometry.js';
import { applyWheelSurfaceState } from './wheelSurface.js';
import { freezeVehicleMotion } from './vehicleKinematics.js';
import { queryRunoffTrackStateForCar } from '../track/trackStatePolicy.js';
import { markCarDnf } from '../race/retirements.js';

export function clearRunoffCenterState(car) {
  if (car) car.pendingRunoffCenterState = null;
}

export function storeRunoffCenterState(car, state) {
  car.pendingRunoffCenterState = {
    state,
    x: car.x,
    y: car.y,
    heading: car.heading,
  };
}

export function takeValidRunoffCenterState(car) {
  const pending = car?.pendingRunoffCenterState;
  if (!pending) return null;
  car.pendingRunoffCenterState = null;
  return pending.x === car.x &&
    pending.y === car.y &&
    pending.heading === car.heading
    ? pending.state
    : null;
}

export function applyRunoffResponseForSimulation(sim, car) {
  if (car.destroyed) {
    clearRunoffCenterState(car);
    freezeBarrierMotion(car, sim.physicsMode);
    applyWheelSurfaceState(car, sim.track);
    return;
  }
  const { state, mainTrackState } = queryRunoffTrackStateForCar(sim.track, car);
  const barrierCenter = sim.track.width / 2 + (sim.track.kerbWidth ?? 0) + sim.track.gravelWidth + sim.track.runoffWidth;
  const signedLimit = barrierCenter - (sim.track.barrierWidth ?? 0) / 2;
  const side = Math.sign(mainTrackState.signedOffset) || 1;
  const outwardReach = getOutwardVehicleReach(car, mainTrackState, side);
  const overshoot = Math.abs(mainTrackState.signedOffset) + outwardReach - signedLimit;
  if (overshoot <= 0) {
    storeRunoffCenterState(car, state);
    return;
  }

  clearRunoffCenterState(car);
  destroyCarOnBarrier(sim, car);
  applyWheelSurfaceState(car, sim.track, { centerState: mainTrackState });
}

function getOutwardVehicleReach(car, state, side) {
  const axes = vehicleAxes(car.heading ?? 0);
  const forwardDot = axes.forward.x * state.normalX + axes.forward.y * state.normalY;
  const rightDot = axes.right.x * state.normalX + axes.right.y * state.normalY;
  return Math.max(
    orientedHalfExtent(VEHICLE_GEOMETRY.visualLength / 2, VEHICLE_GEOMETRY.visualWidth / 2, forwardDot, rightDot),
    orientedHalfExtent(VEHICLE_GEOMETRY.bodyLength / 2, VEHICLE_GEOMETRY.bodyWidth / 2, forwardDot, rightDot),
    wheelOutwardReach(forwardDot, rightDot, side),
  );
}

function orientedHalfExtent(halfLength, halfWidth, forwardDot, rightDot) {
  return Math.abs(forwardDot) * halfLength + Math.abs(rightDot) * halfWidth;
}

function wheelOutwardReach(forwardDot, rightDot, side) {
  const centerOffset =
    Math.abs(forwardDot) * VEHICLE_GEOMETRY.wheelLongitudinalOffset +
    Math.abs(rightDot * side) * VEHICLE_GEOMETRY.wheelLateralOffset;
  return centerOffset + orientedHalfExtent(
    VEHICLE_GEOMETRY.wheelLength / 2,
    VEHICLE_GEOMETRY.wheelWidth / 2,
    forwardDot,
    rightDot,
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
  freezeBarrierMotion(car, sim.physicsMode);
  sim.events.unshift({
    type: 'car-destroyed',
    at: sim.time,
    carId: car.id,
    driverId: car.id,
    reason: 'barrier',
  });
}

function freezeBarrierMotion(car, physicsMode) {
  freezeVehicleMotion(car, {
    clearManualControls: true,
    physicsMode,
    stabilityState: 'destroyed',
  });
}
