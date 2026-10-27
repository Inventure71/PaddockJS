import { normalizeRayOptions } from './rayConfig.js';
import { getCarRayOrigin } from './rayGeometry.js';
import { isSelfCarTarget, rayDetectableTargetsForSnapshot } from './sensorTargets.js';

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

export function getRayScratch(batchContext) {
  return batchContext?.scratch ?? null;
}

export function getNormalizedRayOptions(rayOptions, scratch) {
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

export function getRayOrigin(car, scratch) {
  if (!scratch) return getCarRayOrigin(car);
  const origin = scratch.origin ?? {};
  scratch.origin = origin;
  origin.x = car.x;
  origin.y = car.y;
  return origin;
}

export function getFilteredCarTargets(car, snapshot, batchContext, scratch) {
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

export function prepareScratchArray(scratch, arrayKey, poolKey, count, createItem) {
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

export function getScratchRayVector(scratch, index, car, angleRadians) {
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

export function getSharedRayQuery(scratch, index) {
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

export function getCarRayStats(scratch) {
  if (!scratch) return null;
  const stats = scratch.carRayStats ?? {
    callerVectorCount: 0,
    computedVectorCount: 0,
    resultTargetCount: 0,
  };
  scratch.carRayStats = stats;
  return stats;
}

export function getRayBandTraceStats(scratch) {
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

export function clearRayBatchContextScratch(scratch) {
  if (!scratch) return;
  const arrayKeys = [
    'rayTargets',
    'rayTargetPool',
    'carTargets',
    'rayVectors',
    'sharedRayQueries',
    'rays',
    'rayPool',
    'rayVectorValues',
    'rayVectorValuePool',
  ];
  for (let index = 0; index < arrayKeys.length; index += 1) {
    const value = scratch[arrayKeys[index]];
    if (Array.isArray(value)) value.length = 0;
  }
}
