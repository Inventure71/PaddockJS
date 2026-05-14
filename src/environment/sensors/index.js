import { createCarRayMiss, estimateCarHit } from './carRays.js';
import { normalizeRayOptions } from './rayConfig.js';
import { degreesToRadians, getCarRayOrigin } from './rayGeometry.js';
import { rayDetectableTargetsForSnapshot } from './sensorTargets.js';
import { createTrackMiss, createTrackRayContext, estimateTrackHit } from './trackRays.js';
import { createSurfaceMiss, estimateSurfaceHits, requestedSurfaceChannels } from './surfaceRays.js';
import { canUseBatchTrainingRayApproximation } from './rayGuards.js';
import { ANALYTIC_TRACK_RAY_MAX_CURVATURE } from './rayDefaults.js';
import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';

const BATCH_EXACT_RAY_ANGLE_DEGREES = 10;

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
    return buildFastBatchTrainingRays(car, snapshot, normalized, origin, trackContext.originState, carTargets, trackContext);
  }

  return normalized.rays.map((ray) => {
    const angleDegrees = ray.angleDegrees;
    const vector = {
      x: Math.cos((car.heading ?? 0) + degreesToRadians(angleDegrees)),
      y: Math.sin((car.heading ?? 0) + degreesToRadians(angleDegrees)),
    };
    const roadEdge = normalized.channels.includes('roadEdge')
      ? estimateTrackHit(car, snapshot, angleDegrees, ray.lengthMeters, trackContext, { precision: normalized.precision })
      : createTrackMiss(ray.lengthMeters);
    const carHit = normalized.channels.includes('car')
      ? estimateCarHit(car, snapshot, angleDegrees, ray.lengthMeters, origin, carTargets)
      : createCarRayMiss(ray.lengthMeters);
    const surfaceHits = estimateSurfaceHits(car, snapshot, ray, origin, vector, normalized.channels, trackContext, { precision: normalized.precision });

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

function buildFastBatchTrainingRays(car, snapshot, normalized, origin, originState, carTargets, trackContext) {
  const track = snapshot.track;
  const trackHalfWidth = track.width / 2;
  const kerbOuter = trackHalfWidth + (track.kerbWidth ?? 0);
  const offset = originState.signedOffset ?? car.signedOffset ?? 0;
  const channels = new Set(normalized.channels);

  return normalized.rays.map((ray) => {
    const angleRadians = degreesToRadians(ray.angleDegrees);
    const heading = (car.heading ?? 0) + angleRadians;
    const vector = { x: Math.cos(heading), y: Math.sin(heading) };
    const lateral = vector.x * originState.normalX + vector.y * originState.normalY;
    const needsForwardGeometry = Math.abs(ray.angleDegrees) <= BATCH_EXACT_RAY_ANGLE_DEGREES;
    const canUseLocalApproximation = !needsForwardGeometry &&
      Math.abs(originState.curvature ?? 0) <= ANALYTIC_TRACK_RAY_MAX_CURVATURE &&
      Math.abs(lateral) >= 0.08;
    const roadEdge = channels.has('roadEdge')
      ? canUseLocalApproximation
        ? fastTrackHit({ offset, lateral, trackHalfWidth, lengthMeters: ray.lengthMeters })
        : estimateTrackHit(car, snapshot, ray.angleDegrees, ray.lengthMeters, trackContext, { precision: normalized.precision })
      : createTrackMiss(ray.lengthMeters);
    const carHit = channels.has('car') && carTargets.length > 0
      ? estimateCarHit(car, snapshot, ray.angleDegrees, ray.lengthMeters, origin, carTargets)
      : createCarRayMiss(ray.lengthMeters);
    const exactSurfaceHits = needsForwardGeometry
      ? estimateSurfaceHits(car, snapshot, ray, origin, vector, normalized.channels, trackContext, { precision: normalized.precision })
      : null;

    return {
      id: ray.id,
      angleDegrees: ray.angleDegrees,
      angleRadians,
      lengthMeters: ray.lengthMeters,
      roadEdge,
      track: roadEdge,
      kerb: channels.has('kerb')
        ? (exactSurfaceHits?.kerb ??
          firstHit(
            fastSurfaceHit({ offset, lateral, minAbsOffset: trackHalfWidth, maxAbsOffset: kerbOuter, lengthMeters: ray.lengthMeters, surface: 'kerb' }),
            kerbHitFromTrackTransition(roadEdge, ray.lengthMeters),
          ))
        : createSurfaceMiss(ray.lengthMeters),
      illegalSurface: channels.has('illegalSurface')
        ? (exactSurfaceHits?.illegalSurface ?? fastSurfaceHit({
          offset,
          lateral,
          minAbsOffset: kerbOuter,
          maxAbsOffset: Infinity,
          lengthMeters: ray.lengthMeters,
          surface: illegalSurfaceAtOffset(track, offset, lateral),
        }))
        : createSurfaceMiss(ray.lengthMeters),
      car: carHit,
    };
  });
}

function illegalSurfaceAtOffset(track, offset, lateral) {
  const direction = Math.abs(lateral) >= 0.08 ? Math.sign(lateral) : Math.sign(offset || 1);
  const kerbOuter = track.width / 2 + (track.kerbWidth ?? 0);
  const gravelOuter = kerbOuter + (track.gravelWidth ?? 0);
  const referenceOffset = Math.abs(offset) > kerbOuter ? offset : direction * kerbOuter;
  return Math.abs(referenceOffset) <= gravelOuter ? 'gravel' : 'grass';
}

function fastTrackHit({ offset, lateral, trackHalfWidth, lengthMeters }) {
  if (Math.abs(lateral) < 0.08) return createTrackMiss(lengthMeters);
  const inside = Math.abs(offset) <= trackHalfWidth;
  const target = inside
    ? lateral > 0 ? trackHalfWidth : -trackHalfWidth
    : offset > trackHalfWidth
      ? lateral < 0 ? trackHalfWidth : null
      : offset < -trackHalfWidth
        ? lateral > 0 ? -trackHalfWidth : null
        : null;
  if (target == null) return createTrackMiss(lengthMeters);
  const distance = (target - offset) / lateral;
  const maxDistance = metersToSimUnits(lengthMeters);
  if (distance < 0 || distance > maxDistance) return createTrackMiss(lengthMeters);
  return {
    hit: true,
    distanceMeters: simUnitsToMeters(distance),
    kind: inside ? 'exit' : 'entry',
  };
}

function fastSurfaceHit({ offset, lateral, minAbsOffset, maxAbsOffset, lengthMeters, surface }) {
  if (Math.abs(lateral) < 0.08) return createSurfaceMiss(lengthMeters);
  const currentAbs = Math.abs(offset);
  if (currentAbs >= minAbsOffset && currentAbs <= maxAbsOffset) {
    return { hit: true, distanceMeters: 0, surface };
  }
  const maxDistance = metersToSimUnits(lengthMeters);
  const candidates = [
    (minAbsOffset - offset) / lateral,
    (-minAbsOffset - offset) / lateral,
  ].filter((distance) => Number.isFinite(distance) && distance >= 0 && distance <= maxDistance);
  const distance = candidates.sort((a, b) => a - b)[0];
  if (!Number.isFinite(distance)) return createSurfaceMiss(lengthMeters);
  return {
    hit: true,
    distanceMeters: simUnitsToMeters(distance),
    surface,
  };
}

function firstHit(...hits) {
  return hits.find((hit) => hit?.hit) ?? hits[0] ?? createSurfaceMiss(0);
}

function kerbHitFromTrackTransition(roadEdge, lengthMeters) {
  return roadEdge?.hit
    ? { hit: true, distanceMeters: roadEdge.distanceMeters, surface: 'kerb' }
    : createSurfaceMiss(lengthMeters);
}
