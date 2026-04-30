import { VEHICLE_LIMITS } from './vehiclePhysics.js';

export const REAL_F1_CAR_LENGTH_METERS = 5.63;
export const TARGET_F1_TOP_SPEED_KPH = 330;
export const SIM_UNITS_PER_METER = (VEHICLE_LIMITS.maxSpeed * 3.6) / TARGET_F1_TOP_SPEED_KPH;
export const VISUAL_CAR_LENGTH_METERS = VEHICLE_LIMITS.carLength / SIM_UNITS_PER_METER;

export function metersToSimUnits(meters) {
  return meters * SIM_UNITS_PER_METER;
}

export function simUnitsToMeters(simUnits) {
  return simUnits / SIM_UNITS_PER_METER;
}

export function simSpeedToMetersPerSecond(simUnitsPerSecond) {
  return simUnitsToMeters(simUnitsPerSecond);
}

export function metersPerSecondToSimSpeed(metersPerSecond) {
  return metersToSimUnits(metersPerSecond);
}

export function simSpeedToKph(simUnitsPerSecond) {
  return simSpeedToMetersPerSecond(simUnitsPerSecond) * 3.6;
}

export function kphToSimSpeed(kph) {
  return metersPerSecondToSimSpeed(kph / 3.6);
}
