import { VEHICLE_GEOMETRY } from './vehicleGeometry.js';
import { simUnitsToMeters } from '../units.js';

// SI calibration for the package's DRS-era Formula-style car. Existing setup
// ratings remain force/grip parameters; this is not a particular team's dataset.
export const ADVANCED_VEHICLE_MODEL = Object.freeze({
  gravity: 9.80665,
  wheelbase: simUnitsToMeters(VEHICLE_GEOMETRY.wheelLongitudinalOffset * 2),
  trackWidth: simUnitsToMeters(VEHICLE_GEOMETRY.wheelLateralOffset * 2),
  frontWeightFraction: 0.5, // stored pose/velocity and collision origin are the chassis center
  frontAeroFraction: 0.44,
  frontRollTransferFraction: 0.52,
  centerOfGravityHeight: 0.3,
  yawInertiaPerMass: 1.65, // m²: yaw inertia = mass × radius of gyration squared
  frontBrakeFraction: 0.57,
  tireGripScale: 0.72,
  tireLoadExponent: 0.9,
  corneringStiffnessPerLoad: 28, // N/rad per N of normal load
  maxIntegrationStep: 1 / 240,
  lowSpeedSlipReference: 2.5, // m/s, regularizes the static tire limit
  engineForceScale: 0.5, // legacy force rating to peak rear-axle wheel force
  enginePowerSpeed: 28, // m/s: peak force × crossover speed gives the power envelope
  airDensity: 1.225,
  dragAreaScale: 4.5, // m² per existing dragCoefficient unit
  downforceScale: 0.5, // existing coefficient × v² × scale gives newtons
});

export const ADVANCED_WHEELS = Object.freeze([
  { id: 'front-left', front: true, side: -1 },
  { id: 'front-right', front: true, side: 1 },
  { id: 'rear-left', front: false, side: -1 },
  { id: 'rear-right', front: false, side: 1 },
].map((wheel) => Object.freeze({
  ...wheel,
  x: simUnitsToMeters(VEHICLE_GEOMETRY.wheelLongitudinalOffset) * (wheel.front ? 1 : -1),
  y: simUnitsToMeters(VEHICLE_GEOMETRY.wheelLateralOffset) * wheel.side,
})));

const SURFACES = {
  track: { grip: 1, rolling: 0.012 },
  'pit-entry': { grip: 0.97, rolling: 0.015 },
  'pit-lane': { grip: 0.97, rolling: 0.015 },
  'pit-exit': { grip: 0.97, rolling: 0.015 },
  'pit-box': { grip: 0.94, rolling: 0.02 },
  kerb: { grip: 0.82, rolling: 0.035 },
  gravel: { grip: 0.38, rolling: 0.19 },
  grass: { grip: 0.3, rolling: 0.1 },
  barrier: { grip: 0.2, rolling: 0.25 },
};

export function advancedWheelSurface(car, wheelId) {
  const name = car.wheelStates?.find((wheel) => wheel.id === wheelId)?.surface ?? car.trackState?.surface;
  return SURFACES[name] ?? SURFACES.track;
}

// Requested longitudinal drive force at full throttle, before tire adhesion.
export function advancedDriveForce(car, forwardSpeedMps) {
  return car.powerNewtons * ADVANCED_VEHICLE_MODEL.engineForceScale * Math.min(1, ADVANCED_VEHICLE_MODEL.enginePowerSpeed / Math.max(Math.abs(forwardSpeedMps), ADVANCED_VEHICLE_MODEL.enginePowerSpeed));
}

// Drag force is this coefficient times speed squared. The integrator applies
// it opposite the velocity vector; pace control estimates straight resistance.
export function advancedDragFactor(car) {
  return 0.5 * ADVANCED_VEHICLE_MODEL.airDensity * car.dragCoefficient * ADVANCED_VEHICLE_MODEL.dragAreaScale * (car.drsActive ? 0.72 : 1);
}
