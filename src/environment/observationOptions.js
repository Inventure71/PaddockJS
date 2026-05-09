export const DEFAULT_VECTOR_LOOKAHEAD_METERS = Object.freeze([20, 50, 100, 150]);

export function normalizeLookaheadMeters(value) {
  if (value == null) return [...DEFAULT_VECTOR_LOOKAHEAD_METERS];
  if (!Array.isArray(value)) return [...DEFAULT_VECTOR_LOOKAHEAD_METERS];

  const distances = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));

  return distances.length ? distances : [...DEFAULT_VECTOR_LOOKAHEAD_METERS];
}
