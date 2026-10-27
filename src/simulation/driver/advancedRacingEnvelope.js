import { advancedContactCapacity, advancedNormalLoads } from '../vehicle/advancedTireForces.js';
import { ADVANCED_VEHICLE_MODEL as MODEL, ADVANCED_WHEELS, advancedWheelSurface, advancedDragFactor } from '../vehicle/advancedVehicleModel.js';

const SOLVE_PASSES = 3;
const FEASIBILITY_MARGIN = 0.999;
const INVOCATION_INPUTS = Symbol('racingEnvelopeInvocationInputs');

function prepareInvocationInputs(car, speedMps, scratch) {
  // Buffers persist with scratch; their contents are refreshed unconditionally
  // for this invocation. No car reference or identity-based validity is stored.
  let inputs = scratch[INVOCATION_INPUTS];
  if (!inputs) {
    inputs = { surfaces: [null, null, null, null], nominalLoads: [0, 0, 0, 0] };
    Object.defineProperty(scratch, INVOCATION_INPUTS, { value: inputs });
  }
  inputs.uniformRolling = true;
  inputs.strongestSurface = null;
  for (let index = 0; index < ADVANCED_WHEELS.length; index += 1) {
    const wheel = ADVANCED_WHEELS[index];
    const surface = advancedWheelSurface(car, wheel.id);
    inputs.surfaces[index] = surface;
    inputs.nominalLoads[index] = car.mass * MODEL.gravity * (wheel.front ? MODEL.frontWeightFraction : 1 - MODEL.frontWeightFraction) / 2;
    if (index > 0 && surface.rolling !== inputs.surfaces[0].rolling) inputs.uniformRolling = false;
    if (!inputs.strongestSurface || surface.grip > inputs.strongestSurface.grip) inputs.strongestSurface = surface;
  }
  inputs.staticWeight = car.mass * MODEL.gravity;
  inputs.tireGrip = car.tireGrip;
  inputs.dragForce = advancedDragFactor(car) * speedMps ** 2;
  return inputs;
}

export function createAdvancedRacingEnvelopeScratch() {
  return {
    loads: [0, 0, 0, 0],
    capacities: [0, 0, 0, 0],
    lateralForces: [0, 0, 0, 0],
    longitudinalRemaining: [0, 0, 0, 0],
    driveRemaining: [0, 0, 0, 0],
    brakeRemaining: [0, 0, 0, 0],
  };
}

// The scratch is owned by one synchronous policy decision, never by a car
// identity cache. Lateral force is yaw-balanced between the two equal-length
// axles, then apportioned within each axle by contact capacity.
export function writeAdvancedRacingWheelEnvelope(car, speedMps, tireFactor, scratch, {
  longitudinalAcceleration = 0,
  lateralAcceleration = 0,
} = {}) {
  const inputs = prepareInvocationInputs(car, speedMps, scratch);
  return writeWheelEnvelope(car, speedMps, tireFactor, scratch, inputs, longitudinalAcceleration, lateralAcceleration);
}

function writeWheelEnvelope(car, speedMps, tireFactor, scratch, inputs, longitudinalAcceleration = 0, lateralAcceleration = 0) {
  const loads = advancedNormalLoads(car, speedMps, longitudinalAcceleration, lateralAcceleration);
  let frontCapacity = 0;
  let rearCapacity = 0;
  let rollingResistance = 0;
  for (let index = 0; index < ADVANCED_WHEELS.length; index += 1) {
    const wheel = ADVANCED_WHEELS[index];
    const surface = inputs.surfaces[index];
    const nominalLoad = inputs.nominalLoads[index];
    const capacity = advancedContactCapacity(loads[index], nominalLoad, inputs.tireGrip, tireFactor, surface);
    scratch.loads[index] = loads[index];
    scratch.capacities[index] = capacity;
    if (wheel.front) frontCapacity += capacity;
    else rearCapacity += capacity;
    rollingResistance += surface.rolling * loads[index];
  }
  const lateralAxleForce = Math.abs(lateralAcceleration) * car.mass / 2;
  for (let index = 0; index < ADVANCED_WHEELS.length; index += 1) {
    const capacity = scratch.capacities[index];
    const axleCapacity = ADVANCED_WHEELS[index].front ? frontCapacity : rearCapacity;
    const lateralForce = axleCapacity > 0 ? lateralAxleForce * capacity / axleCapacity : lateralAxleForce / 2;
    scratch.lateralForces[index] = Math.sign(lateralAcceleration) * lateralForce;
    scratch.longitudinalRemaining[index] = Math.sqrt(Math.max(0, capacity ** 2 - lateralForce ** 2));
  }
  scratch.frontCapacity = frontCapacity;
  scratch.rearCapacity = rearCapacity;
  scratch.lateralCapacity = 2 * Math.min(frontCapacity, rearCapacity) / car.mass;
  scratch.lateralFeasible = lateralAxleForce <= Math.min(frontCapacity, rearCapacity);
  scratch.resistanceForce = rollingResistance + inputs.dragForce;
  scratch.uniformRolling = inputs.uniformRolling;
  return scratch;
}

export function estimateAdvancedRacingLateralCapacity(car, speedMps, tireFactor, scratch, {
  turnDirection = Math.sign(car.yawRate || car.lateralAcceleration || 1),
} = {}) {
  const direction = turnDirection < 0 ? -1 : 1;
  const inputs = prepareInvocationInputs(car, speedMps, scratch);
  writeWheelEnvelope(car, speedMps, tireFactor, scratch, inputs);
  let candidate = scratch.lateralCapacity;
  let previous = candidate;
  for (let pass = 0; pass < SOLVE_PASSES; pass += 1) {
    previous = candidate;
    writeWheelEnvelope(car, speedMps, tireFactor, scratch, inputs, 0, direction * candidate);
    candidate = scratch.lateralCapacity;
  }
  let conservative = Math.min(candidate, previous) * FEASIBILITY_MARGIN;
  writeWheelEnvelope(car, speedMps, tireFactor, scratch, inputs, 0, direction * conservative);
  // A bound must fit its own predicted load transfer, including mixed surfaces.
  // One final conservative projection handles unusual rating/load extremes.
  if (!scratch.lateralFeasible) {
    conservative = Math.min(conservative, scratch.lateralCapacity) * FEASIBILITY_MARGIN;
    writeWheelEnvelope(car, speedMps, tireFactor, scratch, inputs, 0, direction * conservative);
  }
  if (!scratch.lateralFeasible) return 0;
  return conservative;
}

function availableLongitudinalForce(scratch, braking) {
  if (!scratch.lateralFeasible) return 0;
  if (!braking) return 2 * Math.min(scratch.longitudinalRemaining[2], scratch.longitudinalRemaining[3]);
  let force = Infinity;
  for (let index = 0; index < ADVANCED_WHEELS.length; index += 1) {
    const fraction = (ADVANCED_WHEELS[index].front ? MODEL.frontBrakeFraction : 1 - MODEL.frontBrakeFraction) / 2;
    force = Math.min(force, scratch.longitudinalRemaining[index] / fraction);
  }
  return force;
}

function writeLongitudinalPrediction(car, speedMps, tireFactor, lateralAcceleration, scratch, force, braking, inputs) {
  const signedForce = braking ? -force : force;
  // Wheel force changes longitudinal load transfer. Drag and rolling oppose
  // forward motion and contribute to the net acceleration seen by physics.
  const passes = scratch.uniformRolling ? 1 : 3;
  for (let pass = 0; pass < passes; pass += 1) {
    const resistance = scratch.resistanceForce;
    writeWheelEnvelope(car, speedMps, tireFactor, scratch, inputs, (signedForce - resistance) / car.mass, lateralAcceleration);
  }
}

function longitudinalMargin(scratch, force, braking) {
  let margin = Infinity;
  for (let index = 0; index < ADVANCED_WHEELS.length; index += 1) {
    const wheel = ADVANCED_WHEELS[index];
    if (!braking && wheel.front) {
      margin = Math.min(margin, scratch.capacities[index] - Math.abs(scratch.lateralForces[index]));
      continue;
    }
    const fraction = braking ? (wheel.front ? MODEL.frontBrakeFraction : 1 - MODEL.frontBrakeFraction) / 2 : 0.5;
    const squared = scratch.capacities[index] ** 2 - scratch.lateralForces[index] ** 2;
    // Keep a signed continuous residual when lateral demand is infeasible.
    // Clamping this to zero would hide feasible nonzero load-transfer windows.
    const remaining = Math.sign(squared) * Math.sqrt(Math.abs(squared));
    margin = Math.min(margin, remaining / fraction - force);
  }
  return margin;
}

function longitudinalForceUpper(car, tireFactor, scratch, inputs) {
  let totalLoad = 0;
  for (let index = 0; index < scratch.loads.length; index += 1) totalLoad += scratch.loads[index];
  // Concavity bounds the sum of contact capacities by distributing normal
  // load in proportion to nominal load, with the strongest surface at all
  // contacts. This bounds force without imposing engine or brake hardware.
  return advancedContactCapacity(totalLoad, inputs.staticWeight, inputs.tireGrip, tireFactor, inputs.strongestSurface);
}

function bracketLongitudinalForce(car, speedMps, tireFactor, lateralAcceleration, scratch, braking, candidate, inputs) {
  const upper = longitudinalForceUpper(car, tireFactor, scratch, inputs);
  const marginAt = (force) => {
    writeLongitudinalPrediction(car, speedMps, tireFactor, lateralAcceleration, scratch, force, braking, inputs);
    return longitudinalMargin(scratch, force, braking);
  };
  let low = candidate;
  if (!(low > 0) || marginAt(low) < 0) {
    low = braking ? Math.min(upper, Math.max(0, (car.brake ?? 0) * car.brakeNewtons)) : 0;
    if (marginAt(low) < 0) {
      // Zero force need not be feasible: braking can load an otherwise weak
      // front axle. Find a feasible seed before bracketing its upper root.
      let left = 0;
      let right = upper;
      const ratio = (Math.sqrt(5) - 1) / 2;
      let first = right - (right - left) * ratio;
      let second = left + (right - left) * ratio;
      let firstMargin = marginAt(first);
      let secondMargin = marginAt(second);
      for (let iteration = 0; iteration < 20; iteration += 1) {
        if (firstMargin < secondMargin) {
          left = first; first = second; firstMargin = secondMargin;
          second = left + (right - left) * ratio; secondMargin = marginAt(second);
        } else {
          right = second; second = first; secondMargin = firstMargin;
          first = right - (right - left) * ratio; firstMargin = marginAt(first);
        }
      }
      low = firstMargin >= secondMargin ? first : second;
      if (marginAt(low) < 0) return 0;
    }
  }
  let high = upper;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const middle = (low + high) / 2;
    if (marginAt(middle) >= 0) low = middle;
    else high = middle;
  }
  // Shrinking toward zero can leave a disconnected feasible interval. Keep
  // the validated feasible endpoint instead of applying a blanket force scale.
  marginAt(low);
  return low;
}

function solveLongitudinalForce(car, speedMps, tireFactor, lateralAcceleration, scratch, braking, remaining, inputs) {
  writeWheelEnvelope(car, speedMps, tireFactor, scratch, inputs, 0, lateralAcceleration);
  let candidate = availableLongitudinalForce(scratch, braking);
  let previous = candidate;
  for (let pass = 0; pass < SOLVE_PASSES; pass += 1) {
    previous = candidate;
    writeLongitudinalPrediction(car, speedMps, tireFactor, lateralAcceleration, scratch, candidate, braking, inputs);
    candidate = availableLongitudinalForce(scratch, braking);
  }
  candidate = Math.min(candidate, previous) * FEASIBILITY_MARGIN;
  writeLongitudinalPrediction(car, speedMps, tireFactor, lateralAcceleration, scratch, candidate, braking, inputs);
  if (candidate > availableLongitudinalForce(scratch, braking)) {
    candidate = availableLongitudinalForce(scratch, braking) * FEASIBILITY_MARGIN;
    writeLongitudinalPrediction(car, speedMps, tireFactor, lateralAcceleration, scratch, candidate, braking, inputs);
  }
  // Retain the cheap iteration when it is feasible and close to the upper
  // root; otherwise a safeguarded bracket handles near-limit transfer.
  const margin = longitudinalMargin(scratch, candidate, braking);
  const probe = candidate / 0.985;
  writeLongitudinalPrediction(car, speedMps, tireFactor, lateralAcceleration, scratch, probe, braking, inputs);
  const probeMargin = longitudinalMargin(scratch, probe, braking);
  if (!(candidate > 0) || margin < 0 || probeMargin >= 0) {
    candidate = bracketLongitudinalForce(car, speedMps, tireFactor, lateralAcceleration, scratch, braking, candidate, inputs);
  }
  writeLongitudinalPrediction(car, speedMps, tireFactor, lateralAcceleration, scratch, candidate, braking, inputs);
  if (longitudinalMargin(scratch, candidate, braking) < 0) candidate = 0;
  for (let index = 0; index < ADVANCED_WHEELS.length; index += 1) remaining[index] = scratch.longitudinalRemaining[index];
  return candidate;
}

export function estimateAdvancedRacingBrakeForce(car, speedMps, tireFactor, lateralAcceleration, scratch) {
  const inputs = prepareInvocationInputs(car, speedMps, scratch);
  return estimateBrakeForce(car, speedMps, tireFactor, lateralAcceleration, scratch, inputs);
}

function estimateBrakeForce(car, speedMps, tireFactor, lateralAcceleration, scratch, inputs) {
  scratch.brakeForce = solveLongitudinalForce(car, speedMps, tireFactor, lateralAcceleration, scratch, true, scratch.brakeRemaining, inputs);
  scratch.brakeResistanceForce = scratch.resistanceForce;
  return scratch;
}

export function estimateAdvancedRacingLongitudinalLimits(car, speedMps, tireFactor, lateralAcceleration, scratch) {
  const inputs = prepareInvocationInputs(car, speedMps, scratch);
  estimateBrakeForce(car, speedMps, tireFactor, lateralAcceleration, scratch, inputs);
  scratch.driveForce = solveLongitudinalForce(car, speedMps, tireFactor, lateralAcceleration, scratch, false, scratch.driveRemaining, inputs);
  scratch.driveResistanceForce = scratch.resistanceForce;
  // Feedforward users see the actual present load state, not the last solver's
  // hypothetical drive state. The solved remaining budgets stay separate.
  writeWheelEnvelope(car, speedMps, tireFactor, scratch, inputs, car.longitudinalAcceleration ?? 0, lateralAcceleration);
  return scratch;
}
