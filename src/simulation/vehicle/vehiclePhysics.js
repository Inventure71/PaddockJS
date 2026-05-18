import { clamp, normalizeAngle } from '../simMath.js';
import {
  REAL_F1_WHEELBASE_METERS,
  SIM_UNITS_PER_METER,
  TOP_SPEED_SIM_UNITS_PER_SECOND,
  metersPerSecondToSimSpeed,
  simUnitsToMeters,
  metersToSimUnits,
} from '../units.js';
import { VEHICLE_GEOMETRY, getCarCorners, vehicleAxes } from './vehicleGeometry.js';

const G = 9.80665;

export const PHYSICS_MODES = ['arcade', 'simulator'];
export const DEFAULT_PHYSICS_MODE = 'arcade';

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

const SIMULATOR_SURFACE_MODEL = {
  track: { grip: 1, drag: 0, rollingResistance: 0.008, scrub: 0 },
  'pit-entry': { grip: 0.92, drag: 0.06, rollingResistance: 0.018, scrub: 1.2 },
  'pit-lane': { grip: 0.9, drag: 0.08, rollingResistance: 0.02, scrub: 1.4 },
  'pit-exit': { grip: 0.92, drag: 0.06, rollingResistance: 0.018, scrub: 1.2 },
  'pit-box': { grip: 0.82, drag: 0.12, rollingResistance: 0.035, scrub: 2.5 },
  kerb: { grip: 0.78, drag: 0.42, rollingResistance: 0.09, scrub: 8.5 },
  gravel: { grip: 0.36, drag: 5.4, rollingResistance: 0.24, scrub: 18 },
  grass: { grip: 0.3, drag: 3.4, rollingResistance: 0.2, scrub: 15 },
  barrier: { grip: 0.08, drag: 15, rollingResistance: 2.4, scrub: 30 },
};

export function normalizePhysicsMode(value) {
  return value === 'simulator' ? 'simulator' : DEFAULT_PHYSICS_MODE;
}

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

function surfaceResistance(surfaceName, model = SURFACE_MODEL) {
  const surface = model[surfaceName] ?? model.track;
  return surface.drag * 0.14 + surface.rollingResistance * 2.4 + (1 - surface.grip) * 0.65;
}

function sideWheelResistance(wheels, side, model = SURFACE_MODEL) {
  const sideWheels = wheels.filter((wheel) => wheel.id?.endsWith(`-${side}`));
  if (!sideWheels.length) return 0;
  return sideWheels.reduce((total, wheel) => total + surfaceResistance(wheel.surface, model), 0) / sideWheels.length;
}

function wheelDragYawRate(car, model = SURFACE_MODEL) {
  const wheels = Array.isArray(car.wheelStates) ? car.wheelStates : [];
  if (!wheels.length) return 0;
  const leftResistance = sideWheelResistance(wheels, 'left', model);
  const rightResistance = sideWheelResistance(wheels, 'right', model);
  const speedFactor = clamp(car.speed / VEHICLE_LIMITS.maxSpeed, 0, 1);
  return clamp(
    (rightResistance - leftResistance) * speedFactor * WHEEL_DRAG_YAW_GAIN,
    -MAX_WHEEL_DRAG_YAW_RATE,
    MAX_WHEEL_DRAG_YAW_RATE,
  );
}

function setPhysicsTelemetry(car, {
  lateralAcceleration = 0,
  longitudinalAcceleration = 0,
  gripUsage = 0,
  slipAngleRadians = 0,
  tractionLimited = false,
  stabilityState = 'stable',
} = {}) {
  car.lateralAcceleration = lateralAcceleration;
  car.longitudinalAcceleration = longitudinalAcceleration;
  car.lateralG = lateralAcceleration / G;
  car.longitudinalG = longitudinalAcceleration / G;
  car.gripUsage = Number.isFinite(gripUsage) ? gripUsage : 0;
  car.slipAngleRadians = Number.isFinite(slipAngleRadians) ? slipAngleRadians : 0;
  car.tractionLimited = Boolean(tractionLimited);
  car.stabilityState = stabilityState;
}

export function integrateVehiclePhysics(car, controls, dt, options = {}) {
  if (normalizePhysicsMode(options.physicsMode) === 'simulator') {
    return integrateSimulatorVehiclePhysics(car, controls, dt, options);
  }
  return integrateArcadeVehiclePhysics(car, controls, dt, options);
}

function integrateArcadeVehiclePhysics(car, controls, dt, options = {}) {
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
  car.steerSaturation = rawYawRate === 0 ? 0 : Math.abs(steeringYawRate / rawYawRate);
  setPhysicsTelemetry(car, {
    lateralAcceleration: speedMetersPerSecond * car.yawRate,
    longitudinalAcceleration: acceleration / SIM_UNITS_PER_METER,
    gripUsage: Math.min(1, Math.abs(speedMetersPerSecond * car.yawRate) /
      Math.max((car.tireGrip * tyreConditionGrip * G + downforceGrip) * surfaceGrip, 1)),
    tractionLimited: Math.abs(rawYawRate) > Math.abs(steeringYawRate) + 1e-6,
    stabilityState: Math.abs(rawYawRate) > Math.abs(steeringYawRate) + 1e-6 ? 'understeer' : 'stable',
  });
  if (options.tireDegradationEnabled !== false) {
    const tyreLoad = Math.abs(car.lateralAcceleration) / G;
    const tireCare = clamp(Number(car.tireCare) || 1, 0.45, 1.8);
    const wearRate = (0.035 + tyreLoad * 0.11 + brake * 0.07 + throttle * 0.025) / tireCare;
    car.tireEnergy = clamp((car.tireEnergy ?? 100) - wearRate * dt, 1, 100);
  }

  return car;
}

function simulatorSurface(surfaceName) {
  return SIMULATOR_SURFACE_MODEL[surfaceName] ?? SIMULATOR_SURFACE_MODEL.track;
}

function aggregateSimulatorSurface(car) {
  const wheels = Array.isArray(car.wheelStates) ? car.wheelStates : [];
  if (!wheels.length) return simulatorSurface(car.trackState?.surface ?? 'track');
  const total = wheels.reduce((sum, wheel) => {
    const surface = simulatorSurface(wheel.surface);
    return {
      grip: sum.grip + surface.grip,
      drag: sum.drag + surface.drag,
      rollingResistance: sum.rollingResistance + surface.rollingResistance,
      scrub: sum.scrub + surface.scrub,
    };
  }, { grip: 0, drag: 0, rollingResistance: 0, scrub: 0 });
  return {
    grip: total.grip / wheels.length,
    drag: total.drag / wheels.length,
    rollingResistance: total.rollingResistance / wheels.length,
    scrub: total.scrub / wheels.length,
  };
}

function simulatorStabilityState({ gripUsage, slipAngle, surfaceName, brake, throttle }) {
  if (gripUsage > 1.32 || Math.abs(slipAngle) > 0.42) return 'spin-risk';
  if (gripUsage > 1.02) return brake > 0.2 && throttle < 0.2 ? 'oversteer' : 'understeer';
  if (surfaceName === 'kerb' && gripUsage > 0.72) return 'oversteer';
  if ((surfaceName === 'gravel' || surfaceName === 'grass') && gripUsage > 0.5) return 'understeer';
  return 'stable';
}

function ensureSimulatorVelocity(car) {
  if (Number.isFinite(car.velocityX) && Number.isFinite(car.velocityY)) return;
  const speed = clamp(Number(car.speed) || 0, 0, VEHICLE_LIMITS.maxSpeed);
  car.velocityX = Math.cos(car.heading ?? 0) * speed;
  car.velocityY = Math.sin(car.heading ?? 0) * speed;
}

function limitSimulatorSpeed(car) {
  const speed = Math.hypot(car.velocityX, car.velocityY);
  if (speed <= VEHICLE_LIMITS.maxSpeed || speed <= 0) return speed;
  const scale = VEHICLE_LIMITS.maxSpeed / speed;
  car.velocityX *= scale;
  car.velocityY *= scale;
  return VEHICLE_LIMITS.maxSpeed;
}

function integrateSimulatorVehiclePhysics(car, controls, dt, options = {}) {
  ensureSimulatorVelocity(car);
  const steeringTarget = clamp(controls.steering ?? 0, -VEHICLE_LIMITS.maxSteer, VEHICLE_LIMITS.maxSteer);
  const steerDelta = clamp(
    steeringTarget - car.steeringAngle,
    -VEHICLE_LIMITS.steerRate * dt,
    VEHICLE_LIMITS.steerRate * dt,
  );
  car.steeringAngle += steerDelta;

  const throttle = clamp(controls.throttle ?? 0, 0, 1);
  const brake = clamp(controls.brake ?? 0, 0, 1);
  const surfaceName = car.trackState?.surface ?? 'track';
  const surface = aggregateSimulatorSurface(car);
  const tireFactor = tirePerformanceFactor(car.tireEnergy ?? 100);
  const surfaceGrip = surface.grip * tireFactor;
  const speedBefore = Math.hypot(car.velocityX, car.velocityY);
  const speedBeforeMps = simUnitsToMeters(speedBefore);
  const speedRatio = clamp(speedBefore / VEHICLE_LIMITS.maxSpeed, 0, 1);
  const downforceGrip = car.downforceCoefficient * speedBeforeMps * speedBeforeMps / car.mass;
  const totalGripAcceleration = Math.max(0.1, (car.tireGrip * tireFactor * G + downforceGrip) * surfaceGrip);
  const axes = vehicleAxes(car.heading ?? 0);
  const forwardVelocity = car.velocityX * axes.forward.x + car.velocityY * axes.forward.y;
  const lateralVelocity = car.velocityX * axes.right.x + car.velocityY * axes.right.y;
  const forwardSpeedMps = simUnitsToMeters(forwardVelocity);
  const lateralSpeedMps = simUnitsToMeters(lateralVelocity);
  const currentSlipAngle = Math.atan2(lateralSpeedMps, Math.max(Math.abs(forwardSpeedMps), 0.1));
  const engineForce = throttle *
    car.powerNewtons *
    (car.drsActive ? 1.07 : 1) *
    Math.max(0.08, 1 - speedRatio ** 1.22);
  const brakeForce = brake * car.brakeNewtons;
  const driveAcceleration = Math.min(
    engineForce / car.mass,
    accelerationLimit(car.speed, surfaceGrip) / SIM_UNITS_PER_METER,
  );
  const brakeDeceleration = Math.min(
    brakeForce / car.mass,
    brakingLimit(car.speed, surfaceGrip) / SIM_UNITS_PER_METER,
  );
  const dragMultiplier = car.drsActive ? 0.46 : 1;
  const dragAcceleration = (
    (car.dragCoefficient * dragMultiplier * 0.28 + surface.drag * 0.018) *
    speedBeforeMps * speedBeforeMps
  ) / car.mass;
  const rollingAcceleration = surface.rollingResistance * G;
  const normalizedSteer = Math.abs(car.steeringAngle) / VEHICLE_LIMITS.maxSteer;
  const speedSensitiveSteer = 1 / (1 + (Math.abs(forwardSpeedMps) / 58) ** 1.85 * 2.35);
  const effectiveSteeringAngle = car.steeringAngle * clamp(speedSensitiveSteer, 0.16, 1);
  const rawYawRate = Math.abs(forwardSpeedMps) <= 0.05
    ? 0
    : (forwardSpeedMps / REAL_F1_WHEELBASE_METERS) * Math.tan(effectiveSteeringAngle);
  const sideSlipDamping = 4.2 + surfaceGrip * 2.1 + speedRatio * 1.6;
  const desiredLateralAcceleration = forwardSpeedMps * rawYawRate - lateralSpeedMps * sideSlipDamping;
  const longitudinalDemand = Math.max(driveAcceleration, brakeDeceleration);
  const longitudinalUsage = clamp(longitudinalDemand / Math.max(totalGripAcceleration * 0.52, 1), 0, 0.94);
  const lateralCapacity = totalGripAcceleration * Math.sqrt(Math.max(0.08, 1 - longitudinalUsage ** 2));
  const desiredLateralAbs = Math.abs(desiredLateralAcceleration);
  const lateralUsage = desiredLateralAbs / Math.max(lateralCapacity, 0.1);
  const gripUsage = Math.sqrt(lateralUsage ** 2 + longitudinalUsage ** 2);
  const tractionLimited = gripUsage > 1 || longitudinalUsage > 0.9;
  const actualLateralAcceleration = clamp(desiredLateralAcceleration, -lateralCapacity, lateralCapacity);
  const steeringYawRate = Math.abs(forwardSpeedMps) <= 0.05 ? 0 : actualLateralAcceleration / Math.max(Math.abs(forwardSpeedMps), 0.1);
  const steeringScrubAcceleration = normalizedSteer ** 1.55 *
    speedRatio ** 1.05 *
    (42 + surface.scrub + Math.max(0, gripUsage - 0.55) * 18);
  const tractionPowerScale = tractionLimited
    ? clamp(1 - (gripUsage - 1) * 0.55 - longitudinalUsage * 0.18, 0.12, 1)
    : 1;
  const brakingDirection = forwardSpeedMps >= -0.2 ? 1 : -1;
  const longitudinalAcceleration =
    driveAcceleration * tractionPowerScale -
    brakeDeceleration * brakingDirection -
    dragAcceleration * Math.sign(forwardSpeedMps || 1) -
    rollingAcceleration * Math.sign(forwardSpeedMps || 1) -
    steeringScrubAcceleration;

  const requestedWheelDragYawRate = wheelDragYawRate(car, SIMULATOR_SURFACE_MODEL) * (surfaceName === 'kerb' ? 1.6 : 1);
  const maxYawRate = speedBeforeMps <= 0.05 ? 0 : totalGripAcceleration / Math.max(speedBeforeMps, 0.1);
  const slipSteeringAuthority = clamp(1 - Math.abs(currentSlipAngle) * 1.8, 0.35, 1);
  const yawTarget = clamp(steeringYawRate * slipSteeringAuthority + requestedWheelDragYawRate, -maxYawRate, maxYawRate);
  const yawResponse = 1.6 + surfaceGrip * 0.9 + speedRatio * 0.5;
  const yawAccelerationCap = speedRatio < 0.18 ? 6.2 : 3.2;
  const maxYawDelta = Math.min(Math.max(0.08, maxYawRate * yawResponse), yawAccelerationCap) * dt;
  car.yawRate = clamp(
    (car.yawRate ?? 0) + clamp(yawTarget - (car.yawRate ?? 0), -maxYawDelta, maxYawDelta),
    -maxYawRate,
    maxYawRate,
  );
  car.wheelDragYawRate = requestedWheelDragYawRate;
  car.heading = normalizeAngle(car.heading + car.yawRate * dt);

  const accelerationX = axes.forward.x * longitudinalAcceleration + axes.right.x * actualLateralAcceleration;
  const accelerationY = axes.forward.y * longitudinalAcceleration + axes.right.y * actualLateralAcceleration;
  car.velocityX += metersToSimUnits(accelerationX) * dt;
  car.velocityY += metersToSimUnits(accelerationY) * dt;
  car.speed = limitSimulatorSpeed(car);
  car.x += car.velocityX * dt;
  car.y += car.velocityY * dt;
  car.throttle = throttle;
  car.brake = brake;
  car.steerSaturation = rawYawRate === 0 ? 0 : Math.abs(steeringYawRate / rawYawRate);
  car.turnRadius = Math.abs(car.yawRate) < 0.001 ? Infinity : car.speed / Math.abs(car.yawRate);
  const velocityHeading = car.speed <= 0.01 ? car.heading : Math.atan2(car.velocityY, car.velocityX);
  const slipAngle = normalizeAngle(velocityHeading - car.heading);
  setPhysicsTelemetry(car, {
    lateralAcceleration: actualLateralAcceleration,
    longitudinalAcceleration,
    gripUsage,
    slipAngleRadians: slipAngle,
    tractionLimited,
    stabilityState: simulatorStabilityState({ gripUsage, slipAngle, surfaceName, brake, throttle }),
  });

  if (options.tireDegradationEnabled !== false) {
    const tyreLoad = Math.abs(car.lateralAcceleration) / G;
    const tireCare = clamp(Number(car.tireCare) || 1, 0.45, 1.8);
    const heatPenalty = Math.max(0, gripUsage - 0.72) * 0.24 + normalizedSteer * speedRatio * 0.08;
    const wearRate = (0.045 + tyreLoad * 0.16 + brake * 0.09 + throttle * 0.035 + heatPenalty) / tireCare;
    car.tireEnergy = clamp((car.tireEnergy ?? 100) - wearRate * dt, 1, 100);
  }

  return car;
}

export { getCarCorners };
