import { TRACK } from './trackConstants.js';

const PROCEDURAL_TRACK_CACHE = new Map();
const TRACK_MODEL_CACHE = new WeakMap();
export const PROCEDURAL_TRACK_CACHE_MAX_ENTRIES = 8;

export function getCachedTrackModel(track) {
  return track === TRACK || Object.isFrozen(track) ? TRACK_MODEL_CACHE.get(track) : null;
}

export function cacheTrackModel(track, model) {
  if (track === TRACK || Object.isFrozen(track)) TRACK_MODEL_CACHE.set(track, freezeTrackModel(model));
}

export function getCachedProceduralTrack(cacheKey) {
  const cached = PROCEDURAL_TRACK_CACHE.get(cacheKey);
  if (!cached) return null;
  PROCEDURAL_TRACK_CACHE.delete(cacheKey);
  PROCEDURAL_TRACK_CACHE.set(cacheKey, cached);
  return cached;
}

export function cacheProceduralTrackDefinition(cacheKey, trackDefinition, model) {
  const frozen = deepFreeze(trackDefinition);
  if (model) TRACK_MODEL_CACHE.set(frozen, freezeTrackModel(model));
  while (PROCEDURAL_TRACK_CACHE.size >= PROCEDURAL_TRACK_CACHE_MAX_ENTRIES) {
    const oldestKey = PROCEDURAL_TRACK_CACHE.keys().next().value;
    if (oldestKey == null) break;
    PROCEDURAL_TRACK_CACHE.delete(oldestKey);
  }
  PROCEDURAL_TRACK_CACHE.set(cacheKey, frozen);
  return frozen;
}

function freezeTrackModel(model) {
  freezeArrayItems(model.samples);
  freezeArrayItems(model.centerlineControls);
  freezeArrayItems(model.sectors);
  freezeArrayItems(model.drsZones);
  deepFreeze(model.pitLane);
  freezeTrackQueryIndex(model.queryIndex);
  return Object.freeze(model);
}

function freezeArrayItems(items) {
  if (!Array.isArray(items)) return;
  items.forEach((item) => deepFreeze(item));
  Object.freeze(items);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach((child) => {
    deepFreeze(child);
  });
  return value;
}

function freezeTrackQueryIndex(index) {
  if (!index || typeof index !== 'object') return index;
  deepFreeze(index.bands);
  freezeCenterlineSegments(index.centerline);
  freezeSpatialGrid(index.grid);
  freezeSpatialGrid(index.segmentGrid);
  freezeArcBuckets(index.arcBuckets);
  freezePitQueryIndex(index.pit);
  return Object.freeze(index);
}

function freezeCenterlineSegments(centerline) {
  if (!centerline || typeof centerline !== 'object') return centerline;
  Object.entries(centerline).forEach(([key, value]) => {
    if (ArrayBuffer.isView(value)) {
      centerline[key] = Object.freeze(Array.from(value));
    }
  });
  return Object.freeze(centerline);
}

function freezeSpatialGrid(grid) {
  if (!grid || typeof grid !== 'object') return grid;
  deepFreeze(grid.bounds);
  freezeArrayItems(grid.cells);
  return Object.freeze(grid);
}

function freezeArcBuckets(arcBuckets) {
  if (!arcBuckets || typeof arcBuckets !== 'object') return arcBuckets;
  if (Array.isArray(arcBuckets.buckets)) {
    arcBuckets.buckets.forEach((bucket) => Object.freeze(bucket));
    Object.freeze(arcBuckets.buckets);
  }
  return Object.freeze(arcBuckets);
}

function freezePitQueryIndex(pit) {
  if (!pit || typeof pit !== 'object') return pit;
  freezeSpatialGrid(pit.roadGrid);
  freezeSpatialGrid(pit.boxGrid);
  deepFreeze(pit.routes);
  freezeArrayItems(pit.roadSegments);
  freezeArrayItems(pit.boxCandidates);
  return Object.freeze(pit);
}
