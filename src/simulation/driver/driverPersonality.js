import { clamp, seededRange } from '../simMath.js';

export function buildDriverPersonality(driver, index, racecraft, random) {
  const numberSeed = Number(driver.driverNumber ?? index + 1);
  const numberBias = (((Number.isFinite(numberSeed) ? numberSeed : index + 1) % 11) - 5) * 0.014;
  const baseAggression = clamp(
    driver.personality?.aggression ?? 0.36 + racecraft * 0.34 + numberBias + seededRange(random, -0.045, 0.045),
    0.18,
    0.88,
  );

  return {
    baseAggression,
    riskTolerance: clamp(
      driver.personality?.riskTolerance ?? baseAggression * 0.72 + racecraft * 0.24 + seededRange(random, -0.04, 0.04),
      0.12,
      0.95,
    ),
    patience: clamp(
      driver.personality?.patience ?? 0.72 - baseAggression * 0.36 + racecraft * 0.12 + seededRange(random, -0.05, 0.05),
      0.18,
      0.9,
    ),
  };
}
