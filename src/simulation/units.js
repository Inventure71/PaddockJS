export const REAL_F1_CAR_LENGTH_METERS = 5.63;
export const REAL_F1_CAR_WIDTH_METERS = 1.9;
export const REAL_F1_WHEELBASE_METERS = 3.6;
export const TARGET_F1_TOP_SPEED_KPH = 330;
export const SIM_UNITS_PER_METER = 12;
export const TOP_SPEED_SIM_UNITS_PER_SECOND = (TARGET_F1_TOP_SPEED_KPH / 3.6) * SIM_UNITS_PER_METER;
export const VISUAL_CAR_LENGTH_METERS = REAL_F1_CAR_LENGTH_METERS;
export const VISUAL_CAR_WIDTH_METERS = REAL_F1_CAR_WIDTH_METERS;

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
