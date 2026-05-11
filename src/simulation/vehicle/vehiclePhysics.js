import { clamp, normalizeAngle } from '../simMath.js';
import {
  REAL_F1_WHEELBASE_METERS,
  SIM_UNITS_PER_METER,
  TOP_SPEED_SIM_UNITS_PER_SECOND,
  simUnitsToMeters,
  metersToSimUnits,
} from '../units.js';
import { VEHICLE_GEOMETRY, getCarCorners } from './vehicleGeometry.js';

const G = 9.80665;

export const VEHICLE_LIMITS = {
  wheelbase: metersToSimUnits(REAL_F1_WHEELBASE_METERS),
  maxSteer: 0.56,
  steerRate: 2.35,
  maxSpeed: TOP_SPEED_SIM_UNITS_PER_SECOND,
  carLength: VEHICLE_GEOMETRY.visualLength,
  carWidth: VEHICLE_GEOMETRY.visualWidth,
};

const SURFACE_MODEL = {
  track: { grip: 1, drag: 0, rollingResistance: 0 },
  'pit-entry': { grip: 0.96, drag: 0.04, rollingResistance: 0.012 },
  'pit-lane': { grip: 0.96, drag: 0.04, rollingResistance: 0.012 },
  'pit-exit': { grip: 0.96, drag: 0.04, rollingResistance: 0.012 },
  'pit-box': { grip: 0.94, drag: 0.08, rollingResistance: 0.025 },
  kerb: { grip: 0.92, drag: 0.12, rollingResistance: 0.045 },
  gravel: { grip: 0.43, drag: 4.0, rollingResistance: 0.68 },
  grass: { grip: 0.34, drag: 1.9, rollingResistance: 0.36 },
  barrier: { grip: 0.18, drag: 9, rollingResistance: 1.2 },
};
const WHEEL_DRAG_YAW_GAIN = 0.08;
const MAX_WHEEL_DRAG_YAW_RATE = 0.22;

function accelerationLimit(speed, surfaceGrip) {
  const speedRatio = clamp(speed / VEHICLE_LIMITS.maxSpeed, 0, 1);
  return SIM_UNITS_PER_METER * surfaceGrip * (17 * (1 - speedRatio ** 2.1) + 1.2);
}

function brakingLimit(speed, surfaceGrip) {
  const speedRatio = clamp(speed / VEHICLE_LIMITS.maxSpeed, 0, 1);
  return SIM_UNITS_PER_METER * surfaceGrip * (20 + speedRatio * 14);
}

export function tirePerformanceFactor(tireEnergy = 100) {
  const normalized = clamp((Number(tireEnergy) || 1) / 100, 0.01, 1);
  return clamp(0.45 + 0.55 * normalized ** 0.72, 0.45, 1);
}

function surfaceResistance(surfaceName) {
  const surface = SURFACE_MODEL[surfaceName] ?? SURFACE_MODEL.track;
  return surface.drag * 0.14 + surface.rollingResistance * 2.4 + (1 - surface.grip) * 0.65;
}

function sideWheelResistance(wheels, side) {
  const sideWheels = wheels.filter((wheel) => wheel.id?.endsWith(`-${side}`));
  if (!sideWheels.length) return 0;
  return sideWheels.reduce((total, wheel) => total + surfaceResistance(wheel.surface), 0) / sideWheels.length;
}

function wheelDragYawRate(car) {
  const wheels = Array.isArray(car.wheelStates) ? car.wheelStates : [];
  if (!wheels.length) return 0;
  const leftResistance = sideWheelResistance(wheels, 'left');
  const rightResistance = sideWheelResistance(wheels, 'right');
  const speedFactor = clamp(car.speed / VEHICLE_LIMITS.maxSpeed, 0, 1);
  return clamp(
    (rightResistance - leftResistance) * speedFactor * WHEEL_DRAG_YAW_GAIN,
    -MAX_WHEEL_DRAG_YAW_RATE,
    MAX_WHEEL_DRAG_YAW_RATE,
  );
}

export function integrateVehiclePhysics(car, controls, dt, options = {}) {
  const steeringTarget = clamp(controls.steering ?? 0, -VEHICLE_LIMITS.maxSteer, VEHICLE_LIMITS.maxSteer);
  const steerDelta = clamp(
    steeringTarget - car.steeringAngle,
    -VEHICLE_LIMITS.steerRate * dt,
    VEHICLE_LIMITS.steerRate * dt,
  );
  car.steeringAngle += steerDelta;

  const throttle = clamp(controls.throttle ?? 0, 0, 1);
  const brake = clamp(controls.brake ?? 0, 0, 1);
  const surface = SURFACE_MODEL[car.trackState?.surface] ?? SURFACE_MODEL.track;
  const tireFactor = tirePerformanceFactor(car.tireEnergy ?? 100);
  const surfaceGrip = surface.grip * tireFactor;
  const dragMultiplier = car.drsActive ? 0.42 : 1;
  const speedRatio = clamp(car.speed / VEHICLE_LIMITS.maxSpeed, 0, 1);
  const engineForce = throttle *
    car.powerNewtons *
    (car.drsActive ? 1.08 : 1) *
    Math.max(0.12, 1 - speedRatio ** 1.15);
  const brakeForce = brake * car.brakeNewtons;
  const speedMetersPerSecondBefore = simUnitsToMeters(car.speed);
  const dragForce = (car.dragCoefficient * dragMultiplier * 0.12 + surface.drag) *
    speedMetersPerSecondBefore * speedMetersPerSecondBefore;
  const rollingForce = surface.rollingResistance * car.mass * G;
  const driveAcceleration = clamp((engineForce / car.mass) * SIM_UNITS_PER_METER, 0, accelerationLimit(car.speed, surfaceGrip));
  const drsAcceleration = car.drsActive ? driveAcceleration * 0.06 : 0;
  const brakeDeceleration = clamp((brakeForce / car.mass) * SIM_UNITS_PER_METER, 0, brakingLimit(car.speed, surfaceGrip));
  const dragDeceleration = ((dragForce + rollingForce) / car.mass) * SIM_UNITS_PER_METER;
  const acceleration = driveAcceleration + drsAcceleration - brakeDeceleration - dragDeceleration;

  car.speed = clamp(car.speed + acceleration * dt, 0, VEHICLE_LIMITS.maxSpeed);

  const speedMetersPerSecond = simUnitsToMeters(car.speed);
  const rawYawRate = (speedMetersPerSecond / REAL_F1_WHEELBASE_METERS) *
    Math.tan(car.steeringAngle) *
    tireFactor;
  const downforceGrip = car.downforceCoefficient * speedMetersPerSecond * speedMetersPerSecond / car.mass;
  const tyreConditionGrip = tireFactor;
  const maxYawRate = ((car.tireGrip * tyreConditionGrip * G + downforceGrip) * surfaceGrip) /
    Math.max(speedMetersPerSecond, 1);
  const steeringYawRate = clamp(rawYawRate, -maxYawRate, maxYawRate);
  const requestedWheelDragYawRate = wheelDragYawRate(car);
  car.yawRate = clamp(steeringYawRate + requestedWheelDragYawRate, -maxYawRate, maxYawRate);
  car.wheelDragYawRate = car.yawRate - steeringYawRate;
  car.turnRadius = Math.abs(car.yawRate) < 0.001 ? Infinity : car.speed / Math.abs(car.yawRate);
  car.heading = normalizeAngle(car.heading + car.yawRate * dt);
  car.x += Math.cos(car.heading) * car.speed * dt;
  car.y += Math.sin(car.heading) * car.speed * dt;
  car.throttle = throttle;
  car.brake = brake;
  car.lateralAcceleration = speedMetersPerSecond * car.yawRate;
  car.steerSaturation = rawYawRate === 0 ? 0 : Math.abs(steeringYawRate / rawYawRate);
  if (options.tireDegradationEnabled !== false) {
    const tyreLoad = Math.abs(car.lateralAcceleration) / G;
    const tireCare = clamp(Number(car.tireCare) || 1, 0.45, 1.8);
    const wearRate = (0.035 + tyreLoad * 0.11 + brake * 0.07 + throttle * 0.025) / tireCare;
    car.tireEnergy = clamp((car.tireEnergy ?? 100) - wearRate * dt, 1, 100);
  }

  return car;
}

export { getCarCorners };
