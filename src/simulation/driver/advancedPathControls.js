import { clamp, normalizeAngle } from '../simMath.js';
import { simUnitsToMeters } from '../units.js';
import { VEHICLE_LIMITS, tirePerformanceFactor } from '../vehicle/vehiclePhysics.js';
import { ADVANCED_VEHICLE_MODEL, advancedDriveForce } from '../vehicle/advancedVehicleModel.js';
import { advancedLateralAccelerationLimit, advancedRearForceCapacity, advancedRollingResistanceForce } from '../vehicle/advancedTireForces.js';

export function advancedSteeringToPoint(car, target) {
  const speed = simUnitsToMeters(car.speed);
  const dx = simUnitsToMeters(target.x - car.x);
  const dy = simUnitsToMeters(target.y - car.y);
  const angle = normalizeAngle(Math.atan2(dy, dx) - car.heading);
  // Pure pursuit gives a geometric curvature in 1/m, then a physical wheel
  // angle. Yaw feedback damps the inertial response without moving the car.
  const curvature = 2 * Math.sin(angle) / Math.max(Math.hypot(dx, dy), 1);
  const desiredYaw = speed * curvature;
  const slip = car.slipAngleRadians ?? 0;
  const countersteer = Math.sign(slip) * Math.max(0, Math.abs(slip) - 0.08) * 0.35;
  return {
    curvature,
    steering: Math.atan(simUnitsToMeters(VEHICLE_LIMITS.wheelbase) * curvature) +
      (desiredYaw - (car.yawRate ?? 0)) * 0.04 + countersteer,
  };
}

export function advancedLongitudinalLimits(car) {
  const speed = simUnitsToMeters(car.speed);
  const tireFactor = tirePerformanceFactor(car.tireEnergy ?? 100);
  const capacity = advancedLateralAccelerationLimit(car, speed, tireFactor);
  const lateralUsage = clamp(Math.abs(speed * (car.yawRate ?? 0)) / capacity, 0, 0.95);
  // Static axle capacity is an estimate: keep a margin for load transfer and
  // reserve the lateral share before requesting rear drive or brake force.
  const longitudinalFraction = Math.sqrt(1 - lateralUsage ** 2) * 0.65;
  const force = capacity * car.mass * longitudinalFraction;
  let driveForce = force * (1 - ADVANCED_VEHICLE_MODEL.frontWeightFraction);
  if (speed < 5 && !car.trackState.onTrack) {
    // A crawling car must overcome all four wheels' rolling resistance. Use
    // the rear tires' remaining adhesion, not an artificial minimum throttle.
    const rearCapacity = advancedRearForceCapacity(car, speed, tireFactor) * Math.sqrt(1 - lateralUsage ** 2);
    const rollingCompensation = advancedRollingResistanceForce(car, speed) * (1 - speed / 5);
    driveForce = Math.min(rearCapacity, driveForce + rollingCompensation);
  }
  const throttleLimit = driveForce / advancedDriveForce(car, speed);
  const brakeLimit = force / car.brakeNewtons;
  return { speed, throttleLimit, brakeLimit };
}

export function advancedSpeedControls(car, targetSpeed) {
  const { speed, throttleLimit, brakeLimit } = advancedLongitudinalLimits(car);
  const error = targetSpeed - speed;
  const brake = clamp(-error / 8, 0, Math.min(0.85, brakeLimit));
  const throttle = brake > 0.03 ? 0 : clamp(error / 8, 0, Math.min(1, throttleLimit));
  return { throttle, brake };
}
