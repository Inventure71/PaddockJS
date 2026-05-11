import { estimateCarHit } from './carRays.js';
import { normalizeRayOptions } from './rayConfig.js';
import { degreesToRadians, getCarRayOrigin } from './rayGeometry.js';
import { rayDetectableTargets } from './sensorTargets.js';
import { createTrackMiss, createTrackRayContext, estimateTrackHit } from './trackRays.js';
import { createSurfaceMiss, estimateSurfaceHits, requestedSurfaceChannels } from './surfaceRays.js';

export { buildNearbyCars } from './nearbyCars.js';
export { DEFAULT_RAY_ANGLES_DEGREES } from './rayDefaults.js';
export { normalizeRayOptions, RAY_CHANNELS, RAY_LAYOUT_PRESETS } from './rayConfig.js';
export { getCarRayOrigin, getCarRayVector } from './rayGeometry.js';

export function buildRaySensors(car, snapshot, rayOptions = {}) {
  const normalized = normalizeRayOptions(rayOptions);
  const origin = getCarRayOrigin(car);
  const usesTrackContext = normalized.channels.includes('roadEdge') ||
    requestedSurfaceChannels(normalized.channels).length > 0;
  const trackContext = !usesTrackContext
    ? null
    : createTrackRayContext(car, snapshot, origin);
  const carTargets = normalized.channels.includes('car')
    ? rayDetectableTargets(car, snapshot)
    : [];

  return normalized.rays.map((ray) => {
    const angleDegrees = ray.angleDegrees;
    const vector = {
      x: Math.cos((car.heading ?? 0) + degreesToRadians(angleDegrees)),
      y: Math.sin((car.heading ?? 0) + degreesToRadians(angleDegrees)),
    };
    const roadEdge = normalized.channels.includes('roadEdge')
      ? estimateTrackHit(car, snapshot, angleDegrees, ray.lengthMeters, trackContext)
      : createTrackMiss(ray.lengthMeters);
    const carHit = normalized.channels.includes('car')
      ? estimateCarHit(car, snapshot, angleDegrees, ray.lengthMeters, origin, carTargets)
      : { hit: false, distanceMeters: ray.lengthMeters, driverId: null, relativeSpeedKph: 0 };
    const surfaceHits = estimateSurfaceHits(car, snapshot, ray, origin, vector, normalized.channels, trackContext);

    return {
      id: ray.id,
      angleDegrees,
      angleRadians: degreesToRadians(angleDegrees),
      lengthMeters: ray.lengthMeters,
      roadEdge,
      track: roadEdge,
      kerb: surfaceHits.kerb ?? createSurfaceMiss(ray.lengthMeters),
      illegalSurface: surfaceHits.illegalSurface ?? createSurfaceMiss(ray.lengthMeters),
      barrier: surfaceHits.barrier ?? createSurfaceMiss(ray.lengthMeters),
      car: carHit,
    };
  });
}
