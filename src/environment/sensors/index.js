import { createCarRayMiss, estimateCarHit } from './carRays.js';
import { normalizeRayOptions } from './rayConfig.js';
import { degreesToRadians, getCarRayOrigin } from './rayGeometry.js';
import { isSelfCarTarget, rayDetectableTargetsForSnapshot } from './sensorTargets.js';
import { createTrackMiss, createTrackRayContext, estimateTrackHit } from './trackRays.js';
import { createSurfaceMiss, estimateSurfaceHits } from './surfaceRays.js';
import { canUseBatchTrainingRayApproximation } from './rayGuards.js';
import { traceIndexedRayBands } from './rayBandTrace.js';
import { createRayChannelFlags, writeRayChannelFlags } from './rayChannels.js';
import { MODEL_RAY_SURFACE_CHANNELS } from '../observationSchema.js';
import { pitOverrideAllowedForCar } from '../../simulation/track/trackStatePolicy.js';

export { buildNearbyCars } from './nearbyCars.js';
export { DEFAULT_RAY_ANGLES_DEGREES } from './rayDefaults.js';
export { RAY_CHANNELS } from './rayChannels.js';
export { normalizeRayOptions, RAY_LAYOUT_PRESETS } from './rayConfig.js';
export { getCarRayOrigin, getCarRayVector } from './rayGeometry.js';

const CHANNEL_CONTEXT = Symbol('rayChannelContext');

export function createRayBatchContext(snapshot, { scratch = false } = {}) {
  const contextScratch = scratch === true
    ? {}
    : scratch && typeof scratch === 'object'
      ? scratch
      : null;
  const context = {
    rayTargets: rayDetectableTargetsForSnapshot(snapshot, contextScratch),
  };
  if (contextScratch) context.scratch = contextScratch;
  return context;
}

function getRayScratch(batchContext) {
  return batchContext?.scratch ?? null;
}

function getNormalizedRayOptions(rayOptions, scratch) {
  if (!scratch || !rayOptions || typeof rayOptions !== 'object') return normalizeRayOptions(rayOptions);
  if (rayOptions?.rays && rayOptions?.channels && rayOptions?.anglesDegrees) {
    return normalizeRayOptions(rayOptions);
  }
  const cache = scratch.normalizedRayOptionsBySource ?? new WeakMap();
  scratch.normalizedRayOptionsBySource = cache;
  const cached = cache.get(rayOptions);
  if (cached) return cached;
  const normalized = normalizeRayOptions(rayOptions);
  cache.set(rayOptions, normalized);
  return normalized;
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
  let count = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (isSelfCarTarget(car, target)) continue;
    filtered[count] = target;
    count += 1;
  }
  filtered.length = count;
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
  query.carHitResult = query.carHitResult ?? {};
  query.surfaceBoundaries = null;
  query.trackBandBoundaries = null;
  query.boundaryStateCache = null;
  query.sampleStateCache = null;
  return query;
}

function getCarRayStats(scratch) {
  if (!scratch) return null;
  const stats = scratch.carRayStats ?? {
    callerVectorCount: 0,
    computedVectorCount: 0,
    resultTargetCount: 0,
  };
  scratch.carRayStats = stats;
  return stats;
}

function estimateCarHitForRay(car, snapshot, ray, origin, vector, carTargets, sharedRayQuery, scratch) {
  return estimateCarHit(car, snapshot, ray.angleDegrees, ray.lengthMeters, origin, carTargets, {
    rayVector: vector,
    resultTarget: sharedRayQuery?.carHitResult,
    stats: getCarRayStats(scratch),
  });
}

function getRayBandTraceStats(scratch) {
  if (!scratch) return null;
  const stats = scratch.rayBandTraceStats ?? {
    directPathCount: 0,
    sampledPathCount: 0,
    fallbackCount: 0,
    channelSetAllocations: 0,
  };
  scratch.rayBandTraceStats = stats;
  return stats;
}

function createRayChannelContext(normalized) {
  if (normalized?.[CHANNEL_CONTEXT]) return normalized[CHANNEL_CONTEXT];
  const channels = writeRayChannelFlags(createRayChannelFlags(), normalized.channels);
  const context = {
    channels,
    surfaceChannels: MODEL_RAY_SURFACE_CHANNELS.filter((channel) => channels.has(channel)),
    hasRoadEdge: channels.hasRoadEdge,
    hasCar: channels.hasCar,
    hasRoadOrSurface: channels.hasRoadEdge || channels.surfaceChannels.length > 0,
  };
  if (normalized) {
    Object.defineProperty(normalized, CHANNEL_CONTEXT, {
      value: context,
      enumerable: false,
    });
  }
  return context;
}

function estimateRayBands({
  car,
  snapshot,
  ray,
  angleDegrees,
  origin,
  vector,
  normalized,
  channelContext,
  trackContext,
  sharedRayQuery,
  scratch,
}) {
  const stats = getRayBandTraceStats(scratch);
  const canUseRayBandTrace = channelContext.hasRoadOrSurface &&
    trackContext?.originState;
  if (canUseRayBandTrace) {
    const direct = traceIndexedRayBands({
      track: snapshot.track,
      origin,
      vector,
      lengthMeters: ray.lengthMeters,
      originState: trackContext.originState,
      channels: channelContext.channels,
      precision: normalized.precision,
      sharedRayQuery,
      stats,
      validateBoundaries: car?.interaction?.profile !== 'batch-training',
      allowPitOverride: car?.interaction?.profile === 'batch-training'
        ? false
        : pitOverrideAllowedForCar(car),
      mainTrackOnly: car?.interaction?.profile === 'batch-training',
    });
    if (direct.available) {
      if (stats) {
        if (direct.path === 'sampled') stats.sampledPathCount += 1;
        else stats.directPathCount += 1;
      }
      return {
        roadEdge: direct.roadEdge,
        surfaceHits: {
          kerb: direct.kerb,
          illegalSurface: direct.illegalSurface,
        },
      };
    }
    if (stats) stats.fallbackCount += 1;
  }

  return {
    roadEdge: channelContext.hasRoadEdge
      ? estimateTrackHit(
        car,
        snapshot,
        angleDegrees,
        ray.lengthMeters,
        trackContext,
        { precision: normalized.precision, sharedRayQuery },
      )
      : createTrackMiss(ray.lengthMeters),
    surfaceHits: estimateSurfaceHits(
      car,
      snapshot,
        ray,
        origin,
        vector,
        channelContext.surfaceChannels,
        trackContext,
        { precision: normalized.precision, sharedRayQuery },
      ),
  };
}

function writeRichRay(target, ray, angleRadians, roadEdge, carHit, surfaceHits, channels) {
  target.id = ray.id;
  target.angleDegrees = ray.angleDegrees;
  target.angleRadians = angleRadians;
  target.lengthMeters = ray.lengthMeters;
  target.roadEdge = writeTrackRayHit(target.roadEdge ?? {}, roadEdge);
  target.track = target.roadEdge;
  target.kerb = channels.hasKerb
    ? writeSurfaceRayHit(target.kerb ?? {}, surfaceHits.kerb ?? createSurfaceMiss(ray.lengthMeters))
    : writeSurfaceRayHit(target.kerb ?? {}, createSurfaceMiss(ray.lengthMeters));
  target.illegalSurface = channels.hasIllegalSurface
    ? writeSurfaceRayHit(target.illegalSurface ?? {}, surfaceHits.illegalSurface ?? createSurfaceMiss(ray.lengthMeters))
    : writeSurfaceRayHit(target.illegalSurface ?? {}, createSurfaceMiss(ray.lengthMeters));
  target.car = writeCarRayHit(target.car ?? {}, carHit);
  return target;
}

function writeTrackRayHit(target, source) {
  target.hit = Boolean(source?.hit);
  target.distanceMeters = source?.distanceMeters;
  target.kind = source?.kind ?? null;
  return target;
}

function writeSurfaceRayHit(target, source) {
  target.hit = Boolean(source?.hit);
  target.distanceMeters = source?.distanceMeters;
  target.surface = source?.surface ?? null;
  return target;
}

function writeCarRayHit(target, source) {
  target.hit = Boolean(source?.hit);
  target.distanceMeters = source?.distanceMeters;
  target.driverId = source?.driverId ?? null;
  target.targetId = source?.targetId ?? null;
  target.targetType = source?.targetType ?? null;
  target.relativeSpeedKph = source?.relativeSpeedKph ?? 0;
  return target;
}

export function buildRaySensors(car, snapshot, rayOptions = {}, batchContext = null) {
  const scratch = getRayScratch(batchContext);
  const normalized = getNormalizedRayOptions(rayOptions, scratch);
  if (!normalized.enabled) return [];
  const channelContext = createRayChannelContext(normalized);
  if (car?.destroyed || car?.outOfRace) {
    return buildInactiveCarRays(normalized, scratch);
  }
  const origin = getRayOrigin(car, scratch);
  const usesTrackContext = channelContext.hasRoadOrSurface;
  const trackContext = !usesTrackContext
    ? null
    : createTrackRayContext(car, snapshot, origin, normalized.precision);
  const carTargets = channelContext.hasCar
    ? getFilteredCarTargets(car, snapshot, batchContext, scratch)
    : [];

  if (canUseFastBatchTrainingRays(car, snapshot, trackContext)) {
    return buildFastBatchTrainingRays(car, snapshot, normalized, channelContext, origin, carTargets, trackContext, scratch);
  }

  const scratchRays = prepareScratchArray(scratch, 'rays', 'rayPool', normalized.rays.length, () => ({}));
  const rays = scratchRays ?? normalized.rays.map(() => ({}));
  for (let index = 0; index < normalized.rays.length; index += 1) {
    const ray = normalized.rays[index];
    const angleDegrees = ray.angleDegrees;
    const angleRadians = degreesToRadians(angleDegrees);
    const vector = getScratchRayVector(scratch, index, car, angleRadians);
    const sharedRayQuery = getSharedRayQuery(scratch, index);
    const { roadEdge, surfaceHits } = estimateRayBands({
      car,
      snapshot,
      ray,
      angleDegrees,
      origin,
      vector,
      normalized,
      channelContext,
      trackContext,
      sharedRayQuery,
      scratch,
    });
    const carHit = channelContext.hasCar
      ? estimateCarHitForRay(car, snapshot, ray, origin, vector, carTargets, sharedRayQuery, scratch)
      : createCarRayMiss(ray.lengthMeters);

    writeRichRay(rays[index], ray, angleRadians, roadEdge, carHit, surfaceHits, channelContext.channels);
  }
  return rays;
}

export function buildRaySensorVectorValues(car, snapshot, rayOptions = {}, batchContext = null) {
  const scratch = getRayScratch(batchContext);
  const normalized = getNormalizedRayOptions(rayOptions, scratch);
  if (!normalized.enabled) return [];
  const channelContext = createRayChannelContext(normalized);
  const surfaceChannels = channelContext.surfaceChannels;
  if (car?.destroyed || car?.outOfRace) {
    return buildInactiveRayVectorValues(normalized, surfaceChannels, scratch);
  }

  const origin = getRayOrigin(car, scratch);
  const usesTrackContext = channelContext.hasRoadOrSurface;
  const trackContext = !usesTrackContext
    ? null
    : createTrackRayContext(car, snapshot, origin, normalized.precision);
  const carTargets = channelContext.hasCar
    ? getFilteredCarTargets(car, snapshot, batchContext, scratch)
    : [];

  const vectorValues = prepareScratchArray(scratch, 'rayVectorValues', 'rayVectorValuePool', normalized.rays.length, () => []);
  const values = vectorValues ?? normalized.rays.map(() => []);
  for (let index = 0; index < normalized.rays.length; index += 1) {
    const ray = normalized.rays[index];
    const angleRadians = degreesToRadians(ray.angleDegrees);
    const vector = getScratchRayVector(scratch, index, car, angleRadians);
    const sharedRayQuery = getSharedRayQuery(scratch, index);
    const { roadEdge, surfaceHits } = estimateRayBands({
      car,
      snapshot,
      ray,
      angleDegrees: ray.angleDegrees,
      origin,
      vector,
      normalized,
      channelContext,
      trackContext,
      sharedRayQuery,
      scratch,
    });
    const carHit = channelContext.hasCar
      ? estimateCarHitForRay(car, snapshot, ray, origin, vector, carTargets, sharedRayQuery, scratch)
      : createCarRayMiss(ray.lengthMeters);
    writeRayVectorValues(values[index], ray.lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels);
  }
  return values;
}

export function appendRaySensorVectorValues(target, car, snapshot, rayOptions = {}, batchContext = null) {
  const scratch = getRayScratch(batchContext);
  const normalized = getNormalizedRayOptions(rayOptions, scratch);
  if (!normalized.enabled) return target;
  const channelContext = createRayChannelContext(normalized);
  const surfaceChannels = channelContext.surfaceChannels;
  if (car?.destroyed || car?.outOfRace) {
    for (let index = 0; index < normalized.rays.length; index += 1) {
      const ray = normalized.rays[index];
      appendRayVectorValues(
        target,
        ray.lengthMeters,
        createTrackMiss(ray.lengthMeters),
        createCarRayMiss(ray.lengthMeters),
        {},
        surfaceChannels,
      );
    }
    return target;
  }

  const origin = getRayOrigin(car, scratch);
  const usesTrackContext = channelContext.hasRoadOrSurface;
  const trackContext = !usesTrackContext
    ? null
    : createTrackRayContext(car, snapshot, origin, normalized.precision);
  const carTargets = channelContext.hasCar
    ? getFilteredCarTargets(car, snapshot, batchContext, scratch)
    : [];

  for (let index = 0; index < normalized.rays.length; index += 1) {
    const ray = normalized.rays[index];
    const angleRadians = degreesToRadians(ray.angleDegrees);
    const vector = getScratchRayVector(scratch, index, car, angleRadians);
    const sharedRayQuery = getSharedRayQuery(scratch, index);
    const { roadEdge, surfaceHits } = estimateRayBands({
      car,
      snapshot,
      ray,
      angleDegrees: ray.angleDegrees,
      origin,
      vector,
      normalized,
      channelContext,
      trackContext,
      sharedRayQuery,
      scratch,
    });
    const carHit = channelContext.hasCar
      ? estimateCarHitForRay(car, snapshot, ray, origin, vector, carTargets, sharedRayQuery, scratch)
      : createCarRayMiss(ray.lengthMeters);
    appendRayVectorValues(target, ray.lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels);
  }
  return target;
}

function buildInactiveCarRays(normalized, scratch = null) {
  const channelContext = createRayChannelContext(normalized);
  const rays = prepareScratchArray(scratch, 'rays', 'rayPool', normalized.rays.length, () => ({})) ??
    normalized.rays.map(() => ({}));
  for (let index = 0; index < normalized.rays.length; index += 1) {
    const ray = normalized.rays[index];
    const roadEdge = createTrackMiss(ray.lengthMeters);
    writeRichRay(
      rays[index],
      ray,
      degreesToRadians(ray.angleDegrees),
      roadEdge,
      createCarRayMiss(ray.lengthMeters),
      {},
      channelContext.channels,
    );
  }
  return rays;
}

function buildInactiveRayVectorValues(normalized, surfaceChannels, scratch = null) {
  const values = prepareScratchArray(scratch, 'rayVectorValues', 'rayVectorValuePool', normalized.rays.length, () => []) ??
    normalized.rays.map(() => []);
  for (let index = 0; index < normalized.rays.length; index += 1) {
    const ray = normalized.rays[index];
    writeRayVectorValues(
      values[index],
      ray.lengthMeters,
      createTrackMiss(ray.lengthMeters),
      createCarRayMiss(ray.lengthMeters),
      {},
      surfaceChannels,
    );
  }
  return values;
}

function writeRayVectorValues(values, lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels) {
  values.length = 0;
  appendRayVectorValues(values, lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels);
  return values;
}

function appendRayVectorValues(values, lengthMeters, roadEdge, carHit, surfaceHits, surfaceChannels) {
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
  for (let index = 0; index < surfaceChannels.length; index += 1) {
    const channel = surfaceChannels[index];
    const hit = surfaceHits[channel] ?? createSurfaceMiss(lengthMeters);
    values.push(
      ratio(hit.distanceMeters, lengthMeters),
      hit.hit ? 1 : 0,
    );
  }
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

function buildFastBatchTrainingRays(car, snapshot, normalized, channelContext, origin, carTargets, trackContext, scratch = null) {
  const rays = prepareScratchArray(scratch, 'rays', 'rayPool', normalized.rays.length, () => ({})) ??
    normalized.rays.map(() => ({}));
  for (let index = 0; index < normalized.rays.length; index += 1) {
    const ray = normalized.rays[index];
    const angleRadians = degreesToRadians(ray.angleDegrees);
    const vector = getScratchRayVector(scratch, index, car, angleRadians);
    const sharedRayQuery = getSharedRayQuery(scratch, index);
    const { roadEdge, surfaceHits } = estimateRayBands({
      car,
      snapshot,
      ray,
      angleDegrees: ray.angleDegrees,
      origin,
      vector,
      normalized,
      channelContext,
      trackContext,
      sharedRayQuery,
      scratch,
    });
    const carHit = channelContext.hasCar && carTargets.length > 0
      ? estimateCarHitForRay(car, snapshot, ray, origin, vector, carTargets, sharedRayQuery, scratch)
      : createCarRayMiss(ray.lengthMeters);

    writeRichRay(rays[index], ray, angleRadians, roadEdge, carHit, surfaceHits, channelContext.channels);
  }
  return rays;
}
