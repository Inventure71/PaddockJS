import { clamp, normalizeAngle } from '../simMath.js';
import { simUnitsToMeters } from '../units.js';
import { VEHICLE_LIMITS, tirePerformanceFactor } from '../vehicle/vehiclePhysics.js';
import { ADVANCED_VEHICLE_MODEL as MODEL, ADVANCED_WHEELS, advancedWheelSurface } from '../vehicle/advancedVehicleModel.js';
import { advancedLateralSlipAngle } from '../vehicle/advancedTireForces.js';
import { createAdvancedRacingEnvelopeScratch, writeAdvancedRacingWheelEnvelope } from './advancedRacingEnvelope.js';
import { racingDriverProfile } from './racingDriverProfile.js';
import { advancedRacingYawResponseSeconds } from './advancedRacingTiming.js';

const WHEEL_SCRATCH = createAdvancedRacingEnvelopeScratch();

export function advancedRacingPathCurvature(car, target) {
  const speed = simUnitsToMeters(car.speed);
  const dx = simUnitsToMeters(target.x - car.x);
  const dy = simUnitsToMeters(target.y - car.y);
  const velocityHeading = speed > 2 && Number.isFinite(car.velocityX) && Number.isFinite(car.velocityY)
    ? Math.atan2(car.velocityY, car.velocityX) : car.heading;
  const angle = normalizeAngle(Math.atan2(dy, dx) - velocityHeading);
  return 2 * Math.sin(angle) / Math.max(Math.hypot(dx, dy), 1);
}

// Racing pursuit follows the velocity direction. The front wheels also need
// tire slip to generate the requested force; geometric steering alone omits
// that demand as the car approaches the nonlinear brush envelope.
export function advancedRacingSteeringToPoint(car, target, profile = racingDriverProfile(car), controls = car) {
  const speed = simUnitsToMeters(car.speed);
  const curvature = advancedRacingPathCurvature(car, target);
  const geometricSteering = Math.atan(MODEL.wheelbase * curvature);
  if (speed < 2) return { curvature, steering: geometricSteering };

  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  const vx = Number.isFinite(car.velocityX) ? simUnitsToMeters(car.velocityX) : speed * cos;
  const vy = Number.isFinite(car.velocityY) ? simUnitsToMeters(car.velocityY) : speed * sin;
  const u = vx * cos + vy * sin;
  const v = -vx * sin + vy * cos;
  const yaw = car.yawRate ?? 0;
  const desiredYaw = speed * curvature;
  const responseSeconds = advancedRacingYawResponseSeconds(profile);
  const frontForce = car.mass * speed ** 2 * curvature / 2 +
    car.mass * MODEL.yawInertiaPerMass * (desiredYaw - yaw) / (MODEL.wheelbase * responseSeconds);
  const envelope = writeAdvancedRacingWheelEnvelope(car, speed, tirePerformanceFactor(car.tireEnergy ?? 100), WHEEL_SCRATCH, {
    longitudinalAcceleration: car.longitudinalAcceleration ?? 0,
    lateralAcceleration: car.lateralAcceleration ?? 0,
  });
  const nominalLoad = car.mass * MODEL.gravity * MODEL.frontWeightFraction / 2;
  const brakingForce = (controls.brake ?? 0) * car.brakeNewtons * MODEL.frontBrakeFraction / 2;
  let weightedSteering = 0;
  let totalWeight = 0;
  for (let index = 0; index < 2; index += 1) {
    const wheel = ADVANCED_WHEELS[index];
    const capacity = envelope.capacities[index];
    const remaining = Math.sqrt(Math.max(0, capacity ** 2 - brakingForce ** 2));
    const lateralForce = clamp(
      frontForce * capacity / Math.max(envelope.frontCapacity, 1e-9),
      -remaining * 0.995, remaining * 0.995,
    );
    const localVelocityAngle = Math.atan2(v + yaw * wheel.x, Math.max(u - yaw * wheel.y, MODEL.lowSpeedSlipReference));
    const bodyLongitudinalForce = -brakingForce - advancedWheelSurface(car, wheel.id).rolling * envelope.loads[index];
    let wheelAngle = localVelocityAngle;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      // Trail braking rotates longitudinal contact force into body-lateral
      // force. Invert that projection along with the brush response.
      const tireLateralForce = clamp((lateralForce - bodyLongitudinalForce * Math.sin(wheelAngle)) /
        Math.max(0.7, Math.cos(wheelAngle)), -remaining * 0.995, remaining * 0.995);
      wheelAngle = localVelocityAngle + advancedLateralSlipAngle({ normalLoad: envelope.loads[index], nominalLoad,
        longitudinalForce: brakingForce, lateralForce: tireLateralForce, capacity });
    }
    weightedSteering += wheelAngle * capacity;
    totalWeight += capacity;
  }
  const forceSteering = totalWeight > 0 ? weightedSteering / totalWeight : geometricSteering;
  const blend = clamp((speed - 2) / 6, 0, 1);
  return { curvature, steering: clamp(geometricSteering + (forceSteering - geometricSteering) * blend,
    -VEHICLE_LIMITS.maxSteer, VEHICLE_LIMITS.maxSteer) };
}
