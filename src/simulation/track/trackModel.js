import { normalizeAngle } from '../simMath.js';
import { CENTERLINE_CONTROLS, TRACK } from './trackConstants.js';
import { distance } from './trackMath.js';
import { rawCenterPoint } from './centerlineSpline.js';
import { generateCenterlineControls, generateFallbackCenterlineControls, generateSafeFallbackCenterlineControls, normalizeSeed } from './proceduralCenterline.js';
import { isValidProceduralTrackModel } from './trackValidation.js';
import { recalculateSampleGeometry } from './sampleGeometry.js';
import { rotateSamplesToStandingStart, straightenStandingStartSamples } from './startStraight.js';
import { createTrackSectors } from './trackSectors.js';
import { deriveDrsZones, normalizeDrsZone } from './drsZones.js';
import { createPitLaneModel } from './pitLaneLayout.js';
import { attachTrackQueryIndex, createTrackQueryIndex } from './trackQueryIndex.js';
import { resolveProceduralTrackOptions } from './trackGenerationOptions.js';

export { WORLD, TRACK } from './trackConstants.js';
export { isInDrsZone } from './drsZones.js';
export { nearestTrackState, offsetTrackPoint, pointAt } from './spatialQueries.js';

const PROCEDURAL_TRACK_CACHE = new Map();
const TRACK_MODEL_CACHE = new WeakMap();

export function buildTrackModel(track = TRACK) {
  const canReuseCachedModel = track === TRACK || Object.isFrozen(track);
  const cached = canReuseCachedModel ? TRACK_MODEL_CACHE.get(track) : null;
  if (cached) return cached;

  const controls = track.centerlineControls ?? CENTERLINE_CONTROLS;
  const base = [];
  for (let index = 0; index <= track.sampleCount; index += 1) {
    base.push(rawCenterPoint(index / track.sampleCount, controls, track.curveInterpolation));
  }

  let totalLength = 0;
  const samples = base.map((point, index) => {
    if (index > 0) totalLength += distance(base[index - 1], point);
    return { ...point, distance: totalLength, heading: 0, normalX: 0, normalY: 0, curvature: 0 };
  });
  recalculateSampleGeometry(samples);

  const startStraightOptions = track.generationOptions?.startStraight;
  const rotatedSamples = rotateSamplesToStandingStart(samples, totalLength, startStraightOptions);
  const straightenedTrack = straightenStandingStartSamples(rotatedSamples, totalLength, startStraightOptions);
  const normalizedSamples = straightenedTrack.samples;
  totalLength = straightenedTrack.totalLength;

  const model = {
    ...track,
    centerlineControls: controls,
    length: totalLength,
    samples: normalizedSamples,
    sectors: createTrackSectors(totalLength),
    drsZones: (track.drsZones ?? deriveDrsZones(normalizedSamples, totalLength))
      .map((zone) => normalizeDrsZone(zone, totalLength)),
  };
  model.pitLane = track.pitLane?.enabled === false || track.generationOptions?.pitLane?.enabled === false
    ? null
    : createPitLaneModel(model);
  attachTrackQueryIndex(model, createTrackQueryIndex(model));
  if (canReuseCachedModel) {
    TRACK_MODEL_CACHE.set(track, freezeTrackModel(model));
  }
  return model;
}

export function createProceduralTrack(seed = Date.now(), options = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const generationOptions = resolveProceduralTrackOptions(options);
  const cacheKey = `${normalizedSeed}:${generationOptions.cacheKey}`;
  const cached = PROCEDURAL_TRACK_CACHE.get(cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt < generationOptions.attempts.primary; attempt += 1) {
    const candidateSeed = (normalizedSeed + Math.imul(attempt, 2654435761)) >>> 0;
    const candidate = {
      ...TRACK,
      name: `Generated GP ${candidateSeed.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`,
      seed: candidateSeed,
      curveInterpolation: 'centripetal',
      centerlineControls: generateCenterlineControls(candidateSeed, generationOptions.shape),
      drsZones: null,
      generationOptions,
      ...(generationOptions.pitLane.enabled === false ? { pitLane: { enabled: false } } : {}),
    };
    const model = buildTrackModel(candidate);
    if (isValidProceduralTrackModel(model, generationOptions)) {
      const trackDefinition = {
        ...candidate,
        drsZones: model.drsZones.map(({ id, startRatio, endRatio }) => ({ id, startRatio, endRatio })),
      };
      return cacheProceduralTrackDefinition(cacheKey, trackDefinition);
    }
  }

  let fallback = null;
  let fallbackModel = null;
  for (let attempt = 0; attempt < generationOptions.attempts.fallback; attempt += 1) {
    const candidateSeed = (normalizedSeed ^ Math.imul(attempt + 1, 2246822519)) >>> 0;
    const candidate = {
      ...TRACK,
      name: `Generated GP ${normalizedSeed.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`,
      seed: candidateSeed,
      curveInterpolation: 'centripetal',
      centerlineControls: generateFallbackCenterlineControls(candidateSeed, generationOptions.shape),
      drsZones: null,
      generationOptions,
      ...(generationOptions.pitLane.enabled === false ? { pitLane: { enabled: false } } : {}),
    };
    const model = buildTrackModel(candidate);
    if (isValidProceduralTrackModel(model, generationOptions)) {
      fallback = candidate;
      fallbackModel = model;
      break;
    }
  }

  if (!fallback || !fallbackModel) {
    fallback = {
      ...TRACK,
      name: `Generated GP ${normalizedSeed.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`,
      seed: normalizedSeed,
      curveInterpolation: 'centripetal',
      centerlineControls: generateSafeFallbackCenterlineControls(normalizedSeed, generationOptions.shape),
      drsZones: null,
      generationOptions,
      ...(generationOptions.pitLane.enabled === false ? { pitLane: { enabled: false } } : {}),
    };
    fallbackModel = buildTrackModel(fallback);
  }
  const fallbackDefinition = {
    ...fallback,
    drsZones: fallbackModel.drsZones.map(({ id, startRatio, endRatio }) => ({ id, startRatio, endRatio })),
  };
  return cacheProceduralTrackDefinition(cacheKey, fallbackDefinition);
}

export { normalizeAngle };

function cacheProceduralTrackDefinition(cacheKey, trackDefinition) {
  const frozen = deepFreeze(trackDefinition);
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
  if (grid.cells instanceof Map) {
    for (const cell of grid.cells.values()) Object.freeze(cell);
    grid.cells = readonlyMap(grid.cells);
  }
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

function readonlyMap(map) {
  return new Proxy(map, {
    get(target, property) {
      if (property === 'set' || property === 'delete' || property === 'clear') {
        return () => {
          throw new TypeError('Cannot mutate a cached track query index');
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set() {
      throw new TypeError('Cannot mutate a cached track query index');
    },
    deleteProperty() {
      throw new TypeError('Cannot mutate a cached track query index');
    },
    defineProperty() {
      throw new TypeError('Cannot mutate a cached track query index');
    },
  });
}
