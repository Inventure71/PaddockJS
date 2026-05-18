export function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function clone(value) {
  if (Array.isArray(value)) return value.map((item) => clone(item));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

export function mergeConfig(base, override) {
  if (!isPlainObject(override)) return clone(base);
  const next = clone(base);
  Object.entries(override).forEach(([key, value]) => {
    next[key] = isPlainObject(value) && isPlainObject(next[key])
      ? mergeConfig(next[key], value)
      : clone(value);
  });
  return next;
}

export function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

export function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function nonNegativeInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : fallback;
}

export function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}
