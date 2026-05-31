import { createCarRayMiss, estimateCarHit } from './carRays.js';
import { normalizeRayOptions } from './rayConfig.js';
import { degreesToRadians, getCarRayOrigin } from './rayGeometry.js';
import { isSelfCarTarget, rayDetectableTargetsForSnapshot } from './sensorTargets.js';
import { createTrackMiss, createTrackRayContext, estimateTrackHit } from './trackRays.js';
import { createSurfaceMiss, estimateSurfaceHits, requestedSurfaceChannels } from './surfaceRays.js';
import { canUseBatchTrainingRayApproximation } from './rayGuards.js';

export { buildNearbyCars } from './nearbyCars.js';
export { DEFAULT_RAY_ANGLES_DEGREES } from './rayDefaults.js';
export { normalizeRayOptions, RAY_CHANNELS, RAY_LAYOUT_PRESETS } from './rayConfig.js';
export { getCarRayOrigin, getCarRayVector } from './rayGeometry.js';

export function createRayBatchContext(snapshot, { scratch = false } = {}) {
  const context = {
    rayTargets: rayDetectableTargetsForSnapshot(snapshot),
  };
  if (scratch) context.scratch = {};
  return context;
}

function getRayScratch(batchContext) {
  return batchContext?.scratch ?? null;
}

function getRayOrigin(car, scratch) {
  if (!scratch) return getCarRayOrigin(car);
  const origin = scratch.origin ?? {};
  scratch.origin = origin;
  origin.x = car.x;
  origin.y = car.y;
  return origin;
}

function getFilteredCarTargets(car, snapshot, batchContext, scratch) {
  const targets = batchContext?.rayTargets ?? rayDetectableTargetsForSnapshot(snapshot);
  if (!scratch) return targets.filter((target) => !isSelfCarTarget(car, target));
  const filtered = scratch.carTargets ?? [];
  scratch.carTargets = filtered;
  filtered.length = 0;
  targets.forEach((target) => {
    if (!isSelfCarTarget(car, target)) filtered.push(target);
  });
  return filtered;
}

function prepareScratchArray(scratch, arrayKey, poolKey, count, createItem) {
  if (!scratch) return null;
  const values = scratch[arrayKey] ?? [];
  const pool = scratch[poolKey] ?? [];
  scratch[arrayKey] = values;
  scratch[poolKey] = pool;
  values.length = count;
  for (let index = 0; index < count; index += 1) {
    const item = pool[index] ?? createItem();
    pool[index] = item;
    values[index] = item;
  }
  return values;
}

function getScratchRayVector(scratch, index, car, angleRadians) {
  if (!scratch) {
    return {
      x: Math.cos((car.heading ?? 0) + angleRadians),
      y: Math.sin((car.heading ?? 0) + angleRadians),
    };
  }
  const vectors = scratch.rayVectors ?? [];
  scratch.rayVectors = vectors;
  const vector = vectors[index] ?? {};
  vectors[index] = vector;
  vector.x = Math.cos((car.heading ?? 0) + angleRadians);
  vector.y = Math.sin((car.heading ?? 0) + angleRadians);
  return vector;
}

function getSharedRayQuery(scratch, index) {
  if (!scratch) return {};
  const queries = scratch.sharedRayQueries ?? [];
  scratch.sharedRayQueries = queries;
  const query = queries[index] ?? {};
  queries[index] = query;
  Object.keys(query).forEach((key) => {
    delete query[key];
  });
  return query;
}

function writeRichRay(target, ray, angleRadians, roadEdge, carHit, surfaceHits, channels) {
  target.id = ray.id;
  target.angleDegrees = ray.angleDegrees;
  target.angleRadians = angleRadians;
  target.lengthMeters = ray.lengthMeters;
  target.roadEdge = roadEdge;
  target.track = roadEdge;
  target.kerb = channels.has('kerb')
    ? (surfaceHits.kerb ?? createSurfaceMiss(ray.lengthMeters))
    : createSurfaceMiss(ray.lengthMeters);
  target.illegalSurface = channels.has('illegalSurface')
    ? (surfaceHits.illegalSurface ?? createSurfaceMiss(ray.lengthMeters))
    : createSurfaceMiss(ray.lengthMeters);
  target.car = carHit;
  return target;
}

export function buildRaySensors(car, snapshot, rayOptions = {}, batchContext = null) {
  const normalized = normalizeRayOptions(rayOptions);
  if (!normalized.enabled) return [];
  const scratch = getRayScratch(batchContext);
  if (car?.destroyed || car?.outOfRace) {
    return buildInactiveCarRays(normalized, scratch);
  }
  const origin = getRayOrigin(car, scratch);
  const usesTrackContext = normalized.channels.includes('roadEdge') ||
    requestedSurfaceChannels(normalized.channels).length > 0;
  const trackContext = !usesTrackContext
    ? null
    : createTrackRayContext(car, snapshot, origin, normalized.precision);
  const carTargets = normalized.channels.includes('car')
    ? getFilteredCarTargets(car, snapshot, batchContext, scratch)
    : [];

  if (canUseFastBatchTrainingRays(car, snapshot, trackContext)) {
    return buildFastBatchTrainingRays(car, snapshot, normalized, origin, carTargets, trackContext, scratch);
  }

  const channels = new Set(normalized.channels);
  const scratchRays = prepareScratchArray(scratch, 'rays', 'rayPool', normalized.rays.length, () => ({}));
  const rays = scratchRays ?? normalized.rays.map(() => ({}));
  normalized.rays.forEach((ray, index) => {
    const angleDegrees = ray.angleDegrees;
    const angleRadians = degreesToRadians(angleDegrees);
    const vector = getScratchRayVector(scratch, index, car, angleRadians);
    const sharedRayQuery = getSharedRayQuery(scratch, index);
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

    writeRichRay(rays[index], ray, angleRadians, roadEdge, carHit, surfaceHits, channels);
  });
  return rays;
}

export function buildRaySensorVectorValues(car, snapshot, rayOptions = {}, batchContext = null) {
  const normalized = normalizeRayOptions(rayOptions);
  if (!normalized.enabled) return [];
  const scratch = getRayScratch(batchContext);
  const surfaceChannels = ['kerb', 'illegalSurface'].filter((channel) => normalized.channels.includes(channel));
  if (car?.destroyed || car?.outOfRace) {
    return buildInactiveRayVectorValues(normalized, surfaceChannels, scratch);
  }

  const origin = getRayOrigin(car, scratch);
  const usesTrackContext = normalized.channels.includes('roadEdge') ||
    requestedSurfaceChannels(normalized.channels).length > 0;
  const trackContext = !usesTrackContext
    ? null
    : createTrackRayContext(car, snapshot, origin, normalized.precision);
  const carTargets = normalized.channels.includes('car')
    ? getFilteredCarTargets(car, snapshot, batchContext, scratch)
    : [];

  const vectorValues = prepareScratchArray(scratch, 'rayVectorValues', 'rayVectorValuePool', normalized.rays.length, () => []);
  const values = vectorValues ?? normalized.rays.map(() => []);
  normalized.rays.forEach((ray, index) => {
    const angleRadians = degreesToRadians(ray.angleDegrees);
    const vector = getScratchRayVector(scratch, index, car, angleRadians);
    const sharedRayQuery = getSharedRayQuery(scratch, index);
    const roadEdge = normalized.channels.includes('roadEdge')
      ? estimateTrackHit(
        car,
        snapshot,
        ray.angleDegrees,
        ray.lengthMeters,
        trackContext,
        { precision: normalized.precision, sharedRayQuery },
      )
      : createTrackMiss(ray.lengthMeters);
    const carHit = normalized.channels.includes('car')
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
    writeRayVectorValues(values[index], ray.lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels);
  });
  return values;
}

function buildInactiveCarRays(normalized, scratch = null) {
  const channels = new Set(normalized.channels);
  const rays = prepareScratchArray(scratch, 'rays', 'rayPool', normalized.rays.length, () => ({})) ??
    normalized.rays.map(() => ({}));
  normalized.rays.forEach((ray, index) => {
    const roadEdge = createTrackMiss(ray.lengthMeters);
    writeRichRay(
      rays[index],
      ray,
      degreesToRadians(ray.angleDegrees),
      roadEdge,
      createCarRayMiss(ray.lengthMeters),
      {},
      channels,
    );
  });
  return rays;
}

function createInactiveRayVectorValues(ray, surfaceChannels) {
  return rayVectorValues(
    ray.lengthMeters,
    createTrackMiss(ray.lengthMeters),
    createCarRayMiss(ray.lengthMeters),
    {},
    surfaceChannels,
  );
}

function buildInactiveRayVectorValues(normalized, surfaceChannels, scratch = null) {
  const values = prepareScratchArray(scratch, 'rayVectorValues', 'rayVectorValuePool', normalized.rays.length, () => []) ??
    normalized.rays.map(() => []);
  normalized.rays.forEach((ray, index) => {
    writeRayVectorValues(
      values[index],
      ray.lengthMeters,
      createTrackMiss(ray.lengthMeters),
      createCarRayMiss(ray.lengthMeters),
      {},
      surfaceChannels,
    );
  });
  return values;
}

function rayVectorValues(lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels) {
  return writeRayVectorValues([], lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels);
}

function writeRayVectorValues(values, lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels) {
  values.length = 0;
  values.push(
    ratio(roadEdge.distanceMeters, lengthMeters),
    roadEdge.hit ? 1 : 0,
    roadEdge.kind === 'exit' ? 1 : 0,
    roadEdge.kind === 'entry' ? 1 : 0,
    ratio(carHit.distanceMeters, lengthMeters),
    carHit.hit ? 1 : 0,
    carHit.relativeSpeedKph / 200,
    carHit.targetType === 'replayGhost' ? 1 : 0,
  );
  surfaceChannels.forEach((channel) => {
    const hit = surfaceHits[channel] ?? createSurfaceMiss(lengthMeters);
    values.push(
      ratio(hit.distanceMeters, lengthMeters),
      hit.hit ? 1 : 0,
    );
  });
  return values;
}

function ratio(value, max) {
  const finite = Number.isFinite(value) ? value : max;
  return Math.max(0, Math.min(1, finite / Math.max(1e-9, max)));
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

function buildFastBatchTrainingRays(car, snapshot, normalized, origin, carTargets, trackContext, scratch = null) {
  const channels = new Set(normalized.channels);

  const rays = prepareScratchArray(scratch, 'rays', 'rayPool', normalized.rays.length, () => ({})) ??
    normalized.rays.map(() => ({}));
  normalized.rays.forEach((ray, index) => {
    const angleRadians = degreesToRadians(ray.angleDegrees);
    const vector = getScratchRayVector(scratch, index, car, angleRadians);
    const sharedRayQuery = getSharedRayQuery(scratch, index);
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

    writeRichRay(rays[index], ray, angleRadians, roadEdge, carHit, surfaceHits, channels);
  });
  return rays;
}
