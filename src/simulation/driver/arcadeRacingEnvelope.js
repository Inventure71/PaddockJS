import { clamp } from '../simMath.js';
import { metersToSimUnits, simUnitsToMeters } from '../units.js';
import {
  arcadeAccelerationLimit,
  arcadeBrakingLimit,
  arcadeResistanceForce,
  arcadeSurfaceGrip,
  tirePerformanceFactor,
  VEHICLE_LIMITS,
} from '../vehicle/vehiclePhysics.js';
import { racingDriverProfile } from './racingDriverProfile.js';

const SPEED_RESPONSE_SECONDS = 0.0625;

function brakeDecelerationAt(car, speedSim, grip) {
  return Math.min(car.brakeNewtons / car.mass, simUnitsToMeters(arcadeBrakingLimit(speedSim, grip)));
}

// All accelerations/speeds here are SI. Arcade has independent longitudinal
// and yaw limits, so this envelope does not add a fictional friction circle.
export function arcadeLongitudinalLimits(car, speedMps = simUnitsToMeters(car.speed)) {
  const speed = clamp(speedMps, 0, simUnitsToMeters(VEHICLE_LIMITS.maxSpeed));
  const speedSim = metersToSimUnits(speed);
  const speedRatio = clamp(speedSim / VEHICLE_LIMITS.maxSpeed, 0, 1);
  const grip = arcadeSurfaceGrip(car) * tirePerformanceFactor(car.tireEnergy ?? 100);
  const engineForce = car.powerNewtons * (car.drsActive ? 1.08 : 1) *
    Math.max(0.12, 1 - speedRatio ** 1.15);
  const drsBonus = car.drsActive ? 1.06 : 1;
  return {
    speed,
    engineForce,
    drsBonus,
    driveAcceleration: Math.min(engineForce / car.mass, simUnitsToMeters(arcadeAccelerationLimit(speedSim, grip))) * drsBonus,
    brakeDeceleration: brakeDecelerationAt(car, speedSim, grip),
    resistanceDeceleration: arcadeResistanceForce(car, speed) / car.mass,
  };
}

export function arcadeBrakingDeceleration(car, speedMps, profile = racingDriverProfile(car)) {
  const speed = clamp(speedMps, 0, simUnitsToMeters(VEHICLE_LIMITS.maxSpeed));
  const grip = arcadeSurfaceGrip(car) * tirePerformanceFactor(car.tireEnergy ?? 100);
  // Preview needs only braking, not engine taper or acceleration capacity.
  return brakeDecelerationAt(car, metersToSimUnits(speed), grip) * clamp(profile.longitudinalShare, 0, 1) +
    arcadeResistanceForce(car, speed) / car.mass;
}

export function arcadeRacingSpeedControls(car, targetSpeedMps, profile = racingDriverProfile(car)) {
  const limits = arcadeLongitudinalLimits(car);
  const target = clamp(targetSpeedMps, 0, simUnitsToMeters(VEHICLE_LIMITS.maxSpeed));
  const share = clamp(profile.longitudinalShare, 0, 1);
  // A single signed force request includes only resistance needed to hold a
  // moving target. Stopping must not request throttle to overcome rolling drag.
  const demand = car.mass * ((target - limits.speed) / SPEED_RESPONSE_SECONDS +
    (target > 0 ? limits.resistanceDeceleration : 0));
  const fullEngineForce = Math.max(limits.engineForce * limits.drsBonus, 1e-9);
  const fullBrakeForce = Math.max(car.brakeNewtons, 1e-9);
  return {
    throttle: clamp(demand / fullEngineForce, 0,
      Math.min(1, limits.driveAcceleration * car.mass * share / fullEngineForce)),
    brake: clamp(-demand / fullBrakeForce, 0,
      Math.min(1, limits.brakeDeceleration * car.mass * share / fullBrakeForce)),
  };
}
