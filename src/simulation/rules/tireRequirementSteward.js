export function calculateTireRequirementPenalty({ car, tireStrategy, rule }) {
  if (!rule || !tireStrategy?.enabled) return null;

  const requiredDistinctCompounds = tireStrategy.mandatoryDistinctDryCompounds;
  if (!Number.isFinite(requiredDistinctCompounds) || requiredDistinctCompounds <= 0) return null;

  const usedCompounds = Array.isArray(car.usedTireCompounds) && car.usedTireCompounds.length
    ? [...new Set(car.usedTireCompounds.filter(Boolean))]
    : [...new Set([car.tire].filter(Boolean))];
  const usedDistinctCompounds = usedCompounds.length;
  const missingCompounds = Math.max(0, requiredDistinctCompounds - usedDistinctCompounds);
  const toleratedMissingCompounds = Math.floor((1 - rule.strictness) * requiredDistinctCompounds);

  if (missingCompounds <= toleratedMissingCompounds) return null;

  return {
    type: 'tire-requirement',
    driverId: car.id,
    strictness: rule.strictness,
    penaltySeconds: rule.timePenaltySeconds,
    consequences: rule.consequences,
    requiredDistinctCompounds,
    usedDistinctCompounds,
    usedCompounds,
    missingCompounds,
    toleratedMissingCompounds,
    reason: 'Mandatory dry compound requirement not met',
  };
}
