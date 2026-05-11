export const DEFAULT_VECTOR_LOOKAHEAD_METERS = Object.freeze([20, 50, 100, 150]);
export const OBSERVATION_PROFILES = Object.freeze(['default', 'physical-driver', 'debug-map']);
export const OBSERVATION_OUTPUTS = Object.freeze(['full', 'vector', 'object']);

export function normalizeObservationOptions(value = {}) {
  const profile = OBSERVATION_PROFILES.includes(value.profile) ? value.profile : 'default';
  const output = OBSERVATION_OUTPUTS.includes(value.output) ? value.output : 'full';
  const physicalDriverDefault = profile === 'physical-driver' && value.lookaheadMeters == null;
  return {
    ...value,
    profile,
    output,
    includeSchema: value.includeSchema !== false,
    lookaheadMeters: physicalDriverDefault
      ? []
      : normalizeLookaheadMeters(value.lookaheadMeters, { allowEmpty: profile === 'physical-driver' }),
  };
}

export function normalizeLookaheadMeters(value, { allowEmpty = false } = {}) {
  if (value == null) return [...DEFAULT_VECTOR_LOOKAHEAD_METERS];
  if (!Array.isArray(value)) return [...DEFAULT_VECTOR_LOOKAHEAD_METERS];

  const distances = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));

  if (allowEmpty && distances.length === 0) return [];
  return distances.length ? distances : [...DEFAULT_VECTOR_LOOKAHEAD_METERS];
}
