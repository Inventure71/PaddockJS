import { estimateCarHit } from './carRays.js';
import { DEFAULT_RAY_ANGLES_DEGREES } from './rayDefaults.js';
import { degreesToRadians, getCarRayOrigin } from './rayGeometry.js';
import { createTrackMiss, createTrackRayContext, estimateTrackHit } from './trackRays.js';

export { buildNearbyCars } from './nearbyCars.js';
export { DEFAULT_RAY_ANGLES_DEGREES } from './rayDefaults.js';
export { getCarRayOrigin, getCarRayVector } from './rayGeometry.js';

export function buildRaySensors(car, snapshot, rayOptions = {}) {
  const angles = rayOptions.anglesDegrees ?? DEFAULT_RAY_ANGLES_DEGREES;
  const lengthMeters = rayOptions.lengthMeters ?? 120;
  const origin = getCarRayOrigin(car);
  const trackContext = rayOptions.detectTrack === false
    ? null
    : createTrackRayContext(car, snapshot, origin);

  return angles.map((angleDegrees) => ({
    angleDegrees,
    angleRadians: degreesToRadians(angleDegrees),
    lengthMeters,
    track: rayOptions.detectTrack === false
      ? createTrackMiss(lengthMeters)
      : estimateTrackHit(car, snapshot, angleDegrees, lengthMeters, trackContext),
    car: rayOptions.detectCars === false
      ? { hit: false, distanceMeters: lengthMeters, driverId: null, relativeSpeedKph: 0 }
      : estimateCarHit(car, snapshot, angleDegrees, lengthMeters, origin),
  }));
}
