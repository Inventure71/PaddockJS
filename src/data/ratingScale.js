export const RATING_MINIMUM = 0;
export const RATING_NEUTRAL = 50;
export const RATING_MAXIMUM = 100;

export function clampRating(value, label, domain) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) throw new Error(`Invalid ${domain} rating for ${label}: ${value}`);
  return Math.min(Math.max(rating, RATING_MINIMUM), RATING_MAXIMUM);
}

export function applyRating(definition, value, direction = 1) {
  const normalized = (value - definition.neutral) / (definition.maximum - definition.neutral);
  return definition.base + normalized * definition.variance * direction;
}
