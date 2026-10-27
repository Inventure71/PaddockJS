import { clamp } from '../simMath.js';
import { simUnitsToMeters } from '../units.js';

const JUDGEMENT_WAVELENGTH_METERS = 180;
const DISTANCE_PHASE_RATE = Math.PI * 2 / JUDGEMENT_WAVELENGTH_METERS;

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizedSkill(value, minimum, maximum, neutral) {
  return clamp((finiteOr(value, neutral) - minimum) / (maximum - minimum), 0, 1);
}

// Input skills are DriverData's constructor values, not its 0..100 ratings.
// Ability controls available precision/margin; willingness to risk it is a
// separate personality input. This policy does not change physical grip.
export function racingDriverProfile(car = {}) {
  const pace = normalizedSkill(car.pace, 0.92, 1.08, 1);
  const racecraft = normalizedSkill(car.racecraft, 0.62, 0.94, 0.78);
  const ability = pace * 0.6 + racecraft * 0.4;
  const consistency = normalizedSkill(car.consistency, 0.59, 0.91, 0.75);
  const aggression = clamp(finiteOr(car.aggression, finiteOr(car.personality?.baseAggression, 0.5)), 0, 1);
  const riskTolerance = clamp(finiteOr(car.personality?.riskTolerance, 0.5), 0, 1);
  const risk = riskTolerance * 0.6 + aggression * 0.4;

  // A continuous distance phase gives a bounded, zero-mean judgement error.
  // It never advances RNG or introduces abrupt per-frame/sector decisions.
  const distanceMeters = simUnitsToMeters(finiteOr(car.raceDistance, finiteOr(car.progress, 0)));
  const phase = distanceMeters * DISTANCE_PHASE_RATE +
    finiteOr(car.index, 0) * 0.73 + finiteOr(car.driverNumber, 0) * 0.31;
  const precisionError = (1 - ability * 0.7) * (1 - consistency * 0.7);
  const lineErrorMeters = 0.2 * precisionError * Math.sin(phase);
  const judgementError = (1 - ability * 0.65) * (1 - consistency * 0.7) * risk;
  const anticipationVariation = 0.025 * judgementError * Math.sin(phase + 1.7);

  return {
    ability,
    consistency,
    risk,
    lateralShare: 0.74 + 0.2 * ability + 0.02 * risk,
    longitudinalShare: 0.86 + 0.09 * ability + 0.03 * risk,
    anticipationSeconds: 0.16 + 0.12 * (1 - ability) +
      0.04 * (1 - consistency) - 0.04 * risk + anticipationVariation,
    lineErrorMeters,
    speedJudgementScale: 1 + 0.012 * judgementError * Math.sin(phase + 0.8),
  };
}
