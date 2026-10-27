import { mergeRayOptionOverrides, normalizeRayOptions } from './sensors/rayConfig.js';

export function defaultSensorOptions(options) {
  return {
    rays: normalizeRayOptions(options.sensors.rays),
    nearbyCars: options.sensors.nearbyCars,
  };
}

export function effectiveSensorOptions(options, driverId, defaultSensors = defaultSensorOptions(options), hasSensorOverrides = true) {
  if (!hasSensorOverrides || !options.sensorsByDriver?.[driverId]) return defaultSensors;
  const rayOverrides = options.sensorsByDriver?.[driverId]?.rays ?? {};
  return {
    rays: normalizeRayOptions(mergeRayOptionOverrides(options.sensors.rays, rayOverrides)),
    nearbyCars: {
      ...options.sensors.nearbyCars,
      ...(options.sensorsByDriver?.[driverId]?.nearbyCars ?? {}),
    },
  };
}
