import { clamp } from '../simMath.js';
import { ADVANCED_VEHICLE_MODEL as MODEL, ADVANCED_WHEELS, advancedWheelSurface } from './advancedVehicleModel.js';

// Quasi-static load transfer: both axles conserve their total vertical load.
// A wheel can unload, but cannot pull down on the ground. This planar model
// does not simulate roll/pitch displacement or suspension travel.
export function advancedNormalLoads(car, speedMps, longitudinalAcceleration, lateralAcceleration) {
  const weight = car.mass * MODEL.gravity;
  const downforce = car.downforceCoefficient * MODEL.downforceScale * speedMps ** 2;
  const aero = car.drsActive ? downforce * 0.82 : downforce;
  const transfer = car.mass * longitudinalAcceleration * MODEL.centerOfGravityHeight / MODEL.wheelbase;
  const total = weight + aero;
  const front = clamp(weight * MODEL.frontWeightFraction + aero * MODEL.frontAeroFraction - transfer, 0, total);
  const rear = total - front;
  const lateralTransfer = car.mass * lateralAcceleration * MODEL.centerOfGravityHeight / MODEL.trackWidth;
  const frontTransfer = clamp(lateralTransfer * MODEL.frontRollTransferFraction, -front / 2, front / 2);
  const rearTransfer = clamp(lateralTransfer * (1 - MODEL.frontRollTransferFraction), -rear / 2, rear / 2);
  return [front / 2 + frontTransfer, front / 2 - frontTransfer, rear / 2 + rearTransfer, rear / 2 - rearTransfer];
}

export function advancedTireForce({ normalLoad, nominalLoad, grip, tireFactor, surface, longitudinalDemand, forwardVelocity, lateralVelocity }) {
  if (normalLoad <= 0) return { longitudinal: 0, lateral: 0, usage: 0, capacity: 0, slipAngle: 0 };
  const capacity = contactCapacity(normalLoad, nominalLoad, grip, tireFactor, surface);
  const slipAngle = Math.atan2(lateralVelocity, Math.max(Math.abs(forwardVelocity), MODEL.lowSpeedSlipReference));
  const stiffness = MODEL.corneringStiffnessPerLoad * nominalLoad * (normalLoad / nominalLoad) ** 0.8;
  const lateralDemand = -stiffness * Math.tan(slipAngle);
  const demand = Math.hypot(longitudinalDemand, lateralDemand);
  const usage = demand / Math.max(capacity, 1e-9);
  const longitudinal = clamp(longitudinalDemand, -capacity, capacity);
  const lateralCapacity = Math.sqrt(Math.max(0, capacity ** 2 - longitudinal ** 2));
  // Longitudinal input is a requested force, not a slip ratio. Reserve its
  // friction-circle share; the brush curve applies to the lateral slip demand.
  const q = lateralCapacity > 1e-9 ? Math.min(Math.abs(lateralDemand) / (3 * lateralCapacity), 1) : 1;
  let lateral = Math.sign(lateralDemand) * lateralCapacity * (1 - (1 - q) ** 3);
  let longitudinalForce = longitudinal;
  // With brake demand beyond adhesion, a sliding contact opposes its actual
  // velocity. This captures directional loss under lock without wheel-spin state.
  if (Math.abs(longitudinalDemand) >= capacity && longitudinalDemand * forwardVelocity < 0) {
    const speed = Math.hypot(forwardVelocity, lateralVelocity);
    longitudinalForce = -capacity * forwardVelocity / speed;
    lateral = -capacity * lateralVelocity / speed;
  }
  return { longitudinal: longitudinalForce, lateral, usage, capacity, slipAngle };

}

// Policy-facing capacity estimate; the driver chooses how much margin to keep.
// No controller gets additional grip beyond these same contact-patch capacities.
function contactCapacity(normalLoad, nominalLoad, grip, tireFactor, surface) {
  return grip * MODEL.tireGripScale * tireFactor * surface.grip * nominalLoad *
    (normalLoad / nominalLoad) ** MODEL.tireLoadExponent;
}

function summedCapacity(car, speedMps, tireFactor, rearOnly) {
  const loads = advancedNormalLoads(car, speedMps, 0, 0);
  let force = 0;
  for (let index = 0; index < ADVANCED_WHEELS.length; index += 1) {
    const wheel = ADVANCED_WHEELS[index];
    if (rearOnly && wheel.front) continue;
    const nominalLoad = car.mass * MODEL.gravity * (wheel.front ? MODEL.frontWeightFraction : 1 - MODEL.frontWeightFraction) / 2;
    const surface = advancedWheelSurface(car, wheel.id);
    force += contactCapacity(loads[index], nominalLoad, car.tireGrip, tireFactor, surface);
  }
  return force;
}

export function advancedLateralAccelerationLimit(car, speedMps, tireFactor) {
  return summedCapacity(car, speedMps, tireFactor, false) / car.mass;
}

export function advancedRearForceCapacity(car, speedMps, tireFactor) {
  return summedCapacity(car, speedMps, tireFactor, true);
}

export function advancedRollingResistanceForce(car, speedMps) {
  const loads = advancedNormalLoads(car, speedMps, 0, 0);
  return ADVANCED_WHEELS.reduce((force, wheel, index) => force + advancedWheelSurface(car, wheel.id).rolling * loads[index], 0);
}
