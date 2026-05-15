import { createCarRayMiss, estimateCarHit } from './carRays.js';
import { normalizeRayOptions } from './rayConfig.js';
import { degreesToRadians, getCarRayOrigin } from './rayGeometry.js';
import { rayDetectableTargetsForSnapshot } from './sensorTargets.js';
import { createTrackMiss, createTrackRayContext, estimateTrackHit } from './trackRays.js';
import { createSurfaceMiss, estimateSurfaceHits, requestedSurfaceChannels } from './surfaceRays.js';
import { canUseBatchTrainingRayApproximation } from './rayGuards.js';

export { buildNearbyCars } from './nearbyCars.js';
export { DEFAULT_RAY_ANGLES_DEGREES } from './rayDefaults.js';
export { normalizeRayOptions, RAY_CHANNELS, RAY_LAYOUT_PRESETS } from './rayConfig.js';
export { getCarRayOrigin, getCarRayVector } from './rayGeometry.js';

export function createRayBatchContext(snapshot) {
  return {
    rayTargets: rayDetectableTargetsForSnapshot(snapshot),
  };
}

export function buildRaySensors(car, snapshot, rayOptions = {}, batchContext = null) {
  const normalized = normalizeRayOptions(rayOptions);
  if (!normalized.enabled) return [];
  if (car?.destroyed || car?.outOfRace) {
    return buildInactiveCarRays(normalized);
  }
  const origin = getCarRayOrigin(car);
  const usesTrackContext = normalized.channels.includes('roadEdge') ||
    requestedSurfaceChannels(normalized.channels).length > 0;
  const trackContext = !usesTrackContext
    ? null
    : createTrackRayContext(car, snapshot, origin);
  const carTargets = normalized.channels.includes('car')
    ? (batchContext?.rayTargets ?? rayDetectableTargetsForSnapshot(snapshot)).filter((target) => target.id !== car.id)
    : [];

  if (canUseFastBatchTrainingRays(car, snapshot, trackContext)) {
    return buildFastBatchTrainingRays(car, snapshot, normalized, origin, carTargets, trackContext);
  }

  return normalized.rays.map((ray) => {
    const angleDegrees = ray.angleDegrees;
    const vector = {
      x: Math.cos((car.heading ?? 0) + degreesToRadians(angleDegrees)),
      y: Math.sin((car.heading ?? 0) + degreesToRadians(angleDegrees)),
    };
    const sharedRayQuery = {};
    const roadEdge = normalized.channels.includes('roadEdge')
      ? estimateTrackHit(
        car,
        snapshot,
        angleDegrees,
        ray.lengthMeters,
        trackContext,
        { precision: normalized.precision, sharedRayQuery },
      )
      : createTrackMiss(ray.lengthMeters);
    const carHit = normalized.channels.includes('car')
      ? estimateCarHit(car, snapshot, angleDegrees, ray.lengthMeters, origin, carTargets)
      : createCarRayMiss(ray.lengthMeters);
    const surfaceHits = estimateSurfaceHits(
      car,
      snapshot,
      ray,
      origin,
      vector,
      normalized.channels,
      trackContext,
      { precision: normalized.precision, sharedRayQuery },
    );

    return {
      id: ray.id,
      angleDegrees,
      angleRadians: degreesToRadians(angleDegrees),
      lengthMeters: ray.lengthMeters,
      roadEdge,
      track: roadEdge,
      kerb: surfaceHits.kerb ?? createSurfaceMiss(ray.lengthMeters),
      illegalSurface: surfaceHits.illegalSurface ?? createSurfaceMiss(ray.lengthMeters),
      car: carHit,
    };
  });
}

function buildInactiveCarRays(normalized) {
  return normalized.rays.map((ray) => ({
    id: ray.id,
    angleDegrees: ray.angleDegrees,
    angleRadians: degreesToRadians(ray.angleDegrees),
    lengthMeters: ray.lengthMeters,
    roadEdge: createTrackMiss(ray.lengthMeters),
    track: createTrackMiss(ray.lengthMeters),
    kerb: createSurfaceMiss(ray.lengthMeters),
    illegalSurface: createSurfaceMiss(ray.lengthMeters),
    car: createCarRayMiss(ray.lengthMeters),
  }));
}

function canUseFastBatchTrainingRays(car, snapshot, trackContext) {
  return car?.interaction?.profile === 'batch-training' &&
    !car.inPitLane &&
    !trackContext?.originState?.inPitLane &&
    Array.isArray(snapshot.track?.samples) &&
    snapshot.track.samples.length > 0 &&
    trackContext?.originState &&
    canUseBatchTrainingRayApproximation(snapshot.track, trackContext.originState);
}

function buildFastBatchTrainingRays(car, snapshot, normalized, origin, carTargets, trackContext) {
  const channels = new Set(normalized.channels);

  return normalized.rays.map((ray) => {
    const angleRadians = degreesToRadians(ray.angleDegrees);
    const heading = (car.heading ?? 0) + angleRadians;
    const vector = { x: Math.cos(heading), y: Math.sin(heading) };
    const sharedRayQuery = {};
    const roadEdge = channels.has('roadEdge')
      ? estimateTrackHit(
        car,
        snapshot,
        ray.angleDegrees,
        ray.lengthMeters,
        trackContext,
        { precision: normalized.precision, sharedRayQuery },
      )
      : createTrackMiss(ray.lengthMeters);
    const carHit = channels.has('car') && carTargets.length > 0
      ? estimateCarHit(car, snapshot, ray.angleDegrees, ray.lengthMeters, origin, carTargets)
      : createCarRayMiss(ray.lengthMeters);
    const surfaceHits = estimateSurfaceHits(
      car,
      snapshot,
      ray,
      origin,
      vector,
      normalized.channels,
      trackContext,
      { precision: normalized.precision, sharedRayQuery },
    );

    return {
      id: ray.id,
      angleDegrees: ray.angleDegrees,
      angleRadians,
      lengthMeters: ray.lengthMeters,
      roadEdge,
      track: roadEdge,
      kerb: channels.has('kerb')
        ? (surfaceHits.kerb ?? createSurfaceMiss(ray.lengthMeters))
        : createSurfaceMiss(ray.lengthMeters),
      illegalSurface: channels.has('illegalSurface')
        ? (surfaceHits.illegalSurface ?? createSurfaceMiss(ray.lengthMeters))
        : createSurfaceMiss(ray.lengthMeters),
      car: carHit,
    };
  });
}
