import { mergeRayOptionOverrides } from './sensors/rayConfig.js';

export function mergeEnvironmentResetOptions(currentOptions, nextOptions = {}) {
  return mergePlainObjects(currentOptions, nextOptions);
}

const REPLACE_OBJECT_PATHS = new Set([
  'scenario.placements',
]);

function mergePlainObjects(base, overrides, path = []) {
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides;
  const merged = { ...base };
  Object.entries(overrides).forEach(([key, value]) => {
    if (value === undefined) return;
    const nextPath = [...path, key];
    if (isPlainObject(value) && isPlainObject(base[key]) && isRayOptionsPath(nextPath)) {
      merged[key] = mergeRayOptionOverrides(base[key], value);
      return;
    }
    merged[key] = isPlainObject(value) &&
      isPlainObject(base[key]) &&
      !REPLACE_OBJECT_PATHS.has(nextPath.join('.'))
      ? mergePlainObjects(base[key], value, nextPath)
      : value;
  });
  return merged;
}

function isPlainObject(value) {
  return value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}


function isRayOptionsPath(path) {
  return (path.length === 2 && path[0] === 'sensors' && path[1] === 'rays') ||
    (path.length === 3 && path[0] === 'sensorsByDriver' && path[2] === 'rays');
}
