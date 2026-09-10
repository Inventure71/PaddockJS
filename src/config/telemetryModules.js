export const DEFAULT_TELEMETRY_MODULES = Object.freeze({
  core: true,
  sectors: true,
  lapTimes: true,
  sectorTimes: true,
});

export function normalizeTelemetryModules(value, defaults = DEFAULT_TELEMETRY_MODULES) {
  const names = Object.keys(defaults);
  if (value === false) return Object.fromEntries(names.map((name) => [name, false]));
  if (value === true || value == null || typeof value !== 'object') return { ...defaults };
  if (Array.isArray(value)) {
    const requested = new Set(value);
    return Object.fromEntries(names.map((name) => [name, requested.has(name)]));
  }
  return Object.fromEntries(names.map((name) => [
    name,
    value[name] == null ? defaults[name] : Boolean(value[name]),
  ]));
}
