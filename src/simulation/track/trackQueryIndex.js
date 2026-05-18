import { clamp, wrapDistance } from '../simMath.js';
import { metersToSimUnits } from '../units.js';

const DEFAULT_GRID_CELL_SIZE = metersToSimUnits(32);
const GRID_NEIGHBOR_LIMIT = 2;
const ARC_BUCKET_COUNT = 512;
const AMBIGUOUS_DISTANCE_EPSILON = 1e-6;
const RAY_TRACE_BUCKET_DEGREES = 10;

export function createTrackQueryIndex(track) {
  const samples = Array.isArray(track.samples) ? track.samples : [];
  const segmentCount = Math.max(0, samples.length - 1);
  const bands = createTrackBands(track);
  const expansion = bands.runoffEdge + (track.barrierWidth ?? 0) + metersToSimUnits(64);
  const bounds = expandedSampleBounds(samples, expansion);
  const centerline = createCenterlineSegments(samples, segmentCount);
  const grid = createSpatialGrid(bounds, DEFAULT_GRID_CELL_SIZE);
  const segmentGrid = createSpatialGrid(bounds, DEFAULT_GRID_CELL_SIZE);
  const arcBuckets = createArcBuckets(track.length, ARC_BUCKET_COUNT);

  for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
    insertSegmentIntoGrid(grid, centerline, segmentId, expansion);
    insertSegmentIntoGrid(segmentGrid, centerline, segmentId, 0);
    insertSegmentIntoArcBuckets(arcBuckets, centerline, segmentId);
  }

  const index = {
    version: 1,
    bands,
    centerline,
    grid,
    segmentGrid,
    arcBuckets,
    pit: createPitQueryIndex(track, grid.cellSize),
    stats: createQueryStats(),
  };
  index.queryScratch = createQueryScratch(index);
  return index;
}

export function queryNearestTrackProjection(track, position, progressHint = null, options = {}) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount) {
    recordFallback(index, 'nearestFallbackReasons', 'missing-index');
    return null;
  }
  if (!finitePoint(position)) {
    recordFallback(index, 'nearestFallbackReasons', 'invalid-position');
    return null;
  }
  index.stats.nearestQueries += 1;

  const mode = options.indexMode === 'sample' ? 'sample' : 'projection';
  const { projection, path, reason } = bestNearestFromIndex(track, index, position, progressHint, mode, options);
  if (!projection) {
    recordFallback(index, 'nearestFallbackReasons', reason ?? 'unknown');
    return null;
  }

  recordStat(index, 'nearestPaths', path);
  return projection;
}

function bestNearestFromIndex(track, index, position, progressHint, mode, options) {
  return mode === 'sample'
    ? bestSampleFromIndex(track, index, position, progressHint, options)
    : bestProjectionFromIndex(index, position, progressHint, options);
}

function bestProjectionFromIndex(index, position, progressHint, options) {
  const hintedCandidateIds = Number.isFinite(progressHint)
    ? candidateIdsFromArcBuckets(index, progressHint, 2)
    : [];
  if (hintedCandidateIds.length) {
    const hinted = bestProjectionFromCandidates(index.centerline, hintedCandidateIds, position, progressHint);
    const maxHintDistance = resolveHintMaxDistance(index, options);
    if (hinted.projection && hinted.projection.distanceSquared <= maxHintDistance * maxHintDistance) {
      return {
        projection: hinted.projection,
        path: hinted.reason === 'tie-resolved' ? 'arc-hint-tie-resolved' : 'arc-hint',
      };
    }
    recordStat(index, 'nearestPaths', hinted.projection ? 'arc-hint-rejected-distance' : `arc-hint-${hinted.reason}`);
  }

  const gridCandidateIds = candidateIdsFromGrid(index, index.grid, position, GRID_NEIGHBOR_LIMIT);
  const grid = bestProjectionFromCandidates(index.centerline, gridCandidateIds, position, progressHint);
  return grid.projection
    ? {
      projection: grid.projection,
      path: grid.reason === 'tie-resolved' ? 'spatial-grid-tie-resolved' : 'spatial-grid',
    }
    : { projection: null, reason: `spatial-grid-${grid.reason}` };
}

function bestSampleFromIndex(track, index, position, progressHint, options) {
  const samples = track?.samples;
  const sampleCount = Math.max(0, samples?.length - 1);
  if (sampleCount <= 0) return { projection: null, reason: 'missing-samples' };
  const hintedCandidateIds = Number.isFinite(progressHint)
    ? candidateIdsFromArcBuckets(index, progressHint, 2)
    : [];
  if (hintedCandidateIds.length) {
    const hinted = bestSampleFromCandidates(index, samples, sampleCount, hintedCandidateIds, position, progressHint);
    const maxHintDistance = resolveHintMaxDistance(index, options);
    if (hinted.sample && hinted.distanceSquared <= maxHintDistance * maxHintDistance) {
      return {
        projection: hinted.sample,
        path: hinted.reason === 'tie-resolved' ? 'arc-hint-tie-resolved' : 'arc-hint',
      };
    }
    recordStat(index, 'nearestPaths', hinted.sample ? 'arc-hint-rejected-distance' : `arc-hint-${hinted.reason}`);
  }

  const gridCandidateIds = candidateIdsFromGrid(index, index.grid, position, GRID_NEIGHBOR_LIMIT);
  const grid = bestSampleFromCandidates(index, samples, sampleCount, gridCandidateIds, position, progressHint);
  return grid.sample
    ? {
      projection: grid.sample,
      path: grid.reason === 'tie-resolved' ? 'spatial-grid-tie-resolved' : 'spatial-grid',
    }
    : { projection: null, reason: `spatial-grid-${grid.reason}` };
}

function resolveHintMaxDistance(index, options = {}) {
  if (options.hintMaxDistance == null) return index.bands.runoffEdge + metersToSimUnits(24);
  if (!Number.isFinite(options.hintMaxDistance)) return Infinity;
  return Math.max(0, options.hintMaxDistance);
}

function bestSampleFromCandidates(index, samples, sampleCount, candidateSegmentIds, position, preferredDistance = null) {
  if (!candidateSegmentIds.length || sampleCount <= 0) return { sample: null, reason: 'no-candidates' };
  const scratch = ensureQueryScratch(index);
  const sampleMarks = ensureScratchArray(scratch, 'sampleMarks', sampleCount);
  const sampleEpoch = nextScratchEpoch(scratch, 'sampleEpoch', sampleMarks);

  let bestSample = null;
  let bestDistanceSquared = Infinity;
  let bestTieScore = Infinity;
  let secondBestDistance = Infinity;
  let tieResolved = false;
  for (const segmentId of candidateSegmentIds) {
    const normalized = ((segmentId % sampleCount) + sampleCount) % sampleCount;
    const adjacent = (normalized + 1) % sampleCount;
    if (sampleMarks[normalized] !== sampleEpoch) {
      sampleMarks[normalized] = sampleEpoch;
      ({ bestSample, bestDistanceSquared, bestTieScore, secondBestDistance, tieResolved } = considerSampleCandidate({
        samples,
        sampleId: normalized,
        position,
        preferredDistance,
        bestSample,
        bestDistanceSquared,
        bestTieScore,
        secondBestDistance,
        tieResolved,
      }));
    }
    if (sampleMarks[adjacent] !== sampleEpoch) {
      sampleMarks[adjacent] = sampleEpoch;
      ({ bestSample, bestDistanceSquared, bestTieScore, secondBestDistance, tieResolved } = considerSampleCandidate({
        samples,
        sampleId: adjacent,
        position,
        preferredDistance,
        bestSample,
        bestDistanceSquared,
        bestTieScore,
        secondBestDistance,
        tieResolved,
      }));
    }
  }

  if (!bestSample) return { sample: null, reason: 'no-best' };

  const ambiguous = Number.isFinite(secondBestDistance) &&
    Math.abs(secondBestDistance - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
  return {
    sample: bestSample,
    distanceSquared: bestDistanceSquared,
    reason: ambiguous || tieResolved ? 'tie-resolved' : 'ok',
  };
}

function considerSampleCandidate({
  samples,
  sampleId,
  position,
  preferredDistance,
  bestSample,
  bestDistanceSquared,
  bestTieScore,
  secondBestDistance,
  tieResolved,
}) {
  const sample = samples[sampleId];
  if (!sample) {
    return { bestSample, bestDistanceSquared, bestTieScore, secondBestDistance, tieResolved };
  }
  const dx = position.x - sample.x;
  const dy = position.y - sample.y;
  const distanceSquared = dx * dx + dy * dy;
  const tieScore = sampleTieScore(sample, preferredDistance);
  if (!bestSample || distanceSquared < bestDistanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
    secondBestDistance = bestDistanceSquared;
    bestSample = sample;
    bestDistanceSquared = distanceSquared;
    bestTieScore = tieScore;
  } else if (Math.abs(distanceSquared - bestDistanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
    tieResolved = true;
    secondBestDistance = Math.min(secondBestDistance, distanceSquared);
    if (tieScore < bestTieScore) {
      bestSample = sample;
      bestDistanceSquared = distanceSquared;
      bestTieScore = tieScore;
    }
  } else if (distanceSquared < secondBestDistance) {
    secondBestDistance = distanceSquared;
  }
  return { bestSample, bestDistanceSquared, bestTieScore, secondBestDistance, tieResolved };
}

function sampleTieScore(sample, preferredDistance) {
  if (!Number.isFinite(preferredDistance)) return sample.distance;
  return Math.abs(sample.distance - preferredDistance);
}

function bestProjectionFromCandidates(centerline, candidateIds, position, preferredDistance = null) {
  if (!candidateIds.length) return { projection: null, reason: 'no-candidates' };
  let best = null;
  let bestTieScore = Infinity;
  let secondBestDistance = Infinity;
  let tieResolved = false;
  for (const segmentId of candidateIds) {
    const projection = projectIndexedSegment(centerline, segmentId, position);
    const tieScore = projectionTieScore(projection, preferredDistance);
    if (!best || projection.distanceSquared < best.distanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
      secondBestDistance = best?.distanceSquared ?? Infinity;
      best = projection;
      bestTieScore = tieScore;
    } else if (Math.abs(projection.distanceSquared - best.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
      tieResolved = true;
      secondBestDistance = Math.min(secondBestDistance, projection.distanceSquared);
      if (tieScore < bestTieScore) {
        best = projection;
        bestTieScore = tieScore;
      }
    } else if (projection.distanceSquared < secondBestDistance) {
      secondBestDistance = projection.distanceSquared;
    }
  }

  if (!best) return { projection: null, reason: 'no-best' };

  const ambiguous = Number.isFinite(secondBestDistance) &&
    Math.abs(secondBestDistance - best.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
  return { projection: best, reason: ambiguous || tieResolved ? 'tie-resolved' : 'ok' };
}

function projectionTieScore(projection, preferredDistance) {
  if (!Number.isFinite(preferredDistance)) return projection.segmentId;
  return Math.abs(projection.distance - preferredDistance);
}

export function queryPitBoxCandidates(track, position) {
  const index = track?.queryIndex;
  const pit = index?.pit;
  if (!pit?.boxGrid) {
    recordFallback(index, 'pitFallbackReasons', 'missing-box-index');
    return null;
  }
  if (!finitePoint(position)) {
    recordFallback(index, 'pitFallbackReasons', 'invalid-position');
    return null;
  }
  index.stats.pitQueries += 1;
  const ids = candidateIdsFromGrid(index, pit.boxGrid, position, 1);
  if (!ids.length) {
    recordStat(index, 'pitPaths', 'box-grid-miss');
    return [];
  }
  recordStat(index, 'pitPaths', 'box-grid-hit');
  return ids.map((id) => pit.boxCandidates[id]).filter(Boolean);
}

export function queryPitRoadSegmentCandidates(track, routeId, position) {
  const candidatesByRoute = queryPitRoadSegmentCandidatesByRoute(track, position);
  return candidatesByRoute?.[routeId] ?? candidatesByRoute;
}

export function queryPitRoadSegmentCandidatesByRoute(track, position) {
  const index = track?.queryIndex;
  const pit = index?.pit;
  if (!pit?.roadGrid) {
    recordFallback(index, 'pitFallbackReasons', 'missing-road-index');
    return null;
  }
  if (!finitePoint(position)) {
    recordFallback(index, 'pitFallbackReasons', 'invalid-position');
    return null;
  }
  index.stats.pitQueries += 1;
  const ids = candidateIdsFromGrid(index, pit.roadGrid, position, 1);
  if (!ids.length) {
    recordStat(index, 'pitPaths', 'road-grid-miss');
    return null;
  }
  const candidatesByRoute = { entry: [], main: [], working: [], exit: [] };
  ids.forEach((id) => {
    const segment = pit.roadSegments[id];
    if (!segment || !candidatesByRoute[segment.routeId]) return;
    candidatesByRoute[segment.routeId].push(segment.segmentIndex);
  });
  recordStat(index, 'pitPaths', 'road-grid-hit');
  return candidatesByRoute;
}

export function queryNearbyTrackProjections(track, position, { neighborLimit = GRID_NEIGHBOR_LIMIT } = {}) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount || !finitePoint(position)) return null;
  const ids = candidateIdsFromGrid(index, index.grid, position, neighborLimit);
  if (!ids.length) return [];
  return ids.map((segmentId) => projectIndexedSegment(index.centerline, segmentId, position));
}

export function queryTrackSegmentsInBounds(track, bounds) {
  const index = track?.queryIndex;
  const grid = index?.segmentGrid ?? index?.grid;
  if (!index?.centerline?.segmentCount || !grid || !finiteBounds(bounds)) return null;
  const ids = candidateIdsFromGridBounds(index, grid, bounds);
  if (!ids.length) return [];
  return ids.map((segmentId) => segmentFromIndex(index.centerline, segmentId));
}

export function queryTrackSegmentsAlongRay(track, origin, vector, maxDistance, margin = 0) {
  const index = track?.queryIndex;
  if (
    !index?.centerline?.segmentCount ||
    !finitePoint(origin) ||
    !Number.isFinite(vector?.x) ||
    !Number.isFinite(vector?.y) ||
    !Number.isFinite(maxDistance) ||
    maxDistance < 0
  ) return null;

  const grid = index.segmentGrid ?? index.grid;
  const scratch = ensureQueryScratch(index);
  const segmentMarks = ensureScratchArray(scratch, 'raySegmentMarks', index.centerline.segmentCount);
  const cellMarks = ensureScratchArray(scratch, 'rayCellMarks', grid.columns * grid.rows);
  const segmentEpoch = nextScratchEpoch(scratch, 'raySegmentEpoch', segmentMarks);
  const cellEpoch = nextScratchEpoch(scratch, 'rayCellEpoch', cellMarks);
  const ids = scratch.raySegmentIds;
  ids.length = 0;
  const radius = Math.max(0, Math.ceil(Math.max(0, margin) / grid.cellSize));
  const step = Math.max(grid.cellSize * 0.5, 1);
  const sampleCount = Math.max(1, Math.ceil(maxDistance / step));
  const visitedCells = scratch.rayVisitedCells;
  visitedCells.length = 0;

  const seed = seedRayTraceFromNearbyCache(index, grid, origin, vector, radius, maxDistance, segmentMarks, segmentEpoch, cellMarks, cellEpoch, ids);

  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const distance = Math.min(maxDistance, sample * step);
    const point = {
      x: origin.x + vector.x * distance,
      y: origin.y + vector.y * distance,
    };
    const center = gridCellForPoint(grid, point, false);
    if (!center) continue;
    for (let row = center.row - radius; row <= center.row + radius; row += 1) {
      for (let column = center.column - radius; column <= center.column + radius; column += 1) {
        if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue;
        const cellIndex = row * grid.columns + column;
        if (cellMarks[cellIndex] === cellEpoch) continue;
        cellMarks[cellIndex] = cellEpoch;
        visitedCells.push(cellIndex);
        const cell = grid.cells[cellIndex];
        if (!cell) continue;
        for (const segmentId of cell) {
          if (segmentMarks[segmentId] === segmentEpoch) continue;
          segmentMarks[segmentId] = segmentEpoch;
          ids.push(segmentId);
        }
      }
    }
  }

  storeRayTraceCache(index, grid, origin, vector, radius, maxDistance, ids, visitedCells, seed);
  if (!ids.length) return [];
  return ids.map((segmentId) => segmentFromIndex(index.centerline, segmentId));
}

export function attachTrackQueryIndex(track, queryIndex) {
  Object.defineProperty(track, 'queryIndex', {
    configurable: true,
    enumerable: false,
    value: queryIndex,
    writable: false,
  });
  return track;
}

export function forkTrackQueryIndex(sourceIndex) {
  if (!sourceIndex || typeof sourceIndex !== 'object') return null;
  return {
    ...sourceIndex,
    stats: createQueryStats(),
    queryScratch: createQueryScratch(sourceIndex),
  };
}

export function resetTrackQueryStats(track) {
  const stats = track?.queryIndex?.stats;
  if (!stats) return null;
  Object.assign(stats, createQueryStats());
  return stats;
}

export function snapshotTrackQueryStats(track) {
  const stats = track?.queryIndex?.stats;
  return stats ? JSON.parse(JSON.stringify(stats)) : null;
}

function createQueryStats() {
  return {
    nearestQueries: 0,
    nearestFallbacks: 0,
    nearestPaths: {},
    nearestFallbackReasons: {
      'spatial-grid-no-candidates': 0,
    },
    pitQueries: 0,
    pitFallbacks: 0,
    pitPaths: {},
    pitFallbackReasons: {},
  };
}

function recordFallback(index, bucket, reason) {
  if (!index?.stats) return;
  if (bucket.startsWith('nearest')) index.stats.nearestFallbacks += 1;
  if (bucket.startsWith('pit')) index.stats.pitFallbacks += 1;
  recordStat(index, bucket, reason);
}

function recordStat(index, bucket, reason) {
  if (!index?.stats || !reason) return;
  const target = index.stats[bucket] ?? {};
  target[reason] = (target[reason] ?? 0) + 1;
  index.stats[bucket] = target;
}

function createTrackBands(track) {
  const trackEdge = track.width / 2;
  const kerbEdge = trackEdge + (track.kerbWidth ?? 0);
  const gravelEdge = kerbEdge + (track.gravelWidth ?? 0);
  const runoffEdge = gravelEdge + (track.runoffWidth ?? 0);
  const barrierInnerFace = runoffEdge - (track.barrierWidth ?? 0) / 2;
  return {
    trackEdge,
    kerbEdge,
    gravelEdge,
    runoffEdge,
    barrierInnerFace,
  };
}

function createCenterlineSegments(samples, segmentCount) {
  const startX = new Float64Array(segmentCount);
  const startY = new Float64Array(segmentCount);
  const endX = new Float64Array(segmentCount);
  const endY = new Float64Array(segmentCount);
  const startDistance = new Float64Array(segmentCount);
  const endDistance = new Float64Array(segmentCount);
  const heading = new Float64Array(segmentCount);
  const normalX = new Float64Array(segmentCount);
  const normalY = new Float64Array(segmentCount);
  const endNormalX = new Float64Array(segmentCount);
  const endNormalY = new Float64Array(segmentCount);
  const curvature = new Float64Array(segmentCount);
  const minX = new Float64Array(segmentCount);
  const maxX = new Float64Array(segmentCount);
  const minY = new Float64Array(segmentCount);
  const maxY = new Float64Array(segmentCount);

  for (let id = 0; id < segmentCount; id += 1) {
    const start = samples[id];
    const end = samples[id + 1];
    startX[id] = start.x;
    startY[id] = start.y;
    endX[id] = end.x;
    endY[id] = end.y;
    startDistance[id] = start.distance;
    endDistance[id] = end.distance;
    heading[id] = start.heading;
    normalX[id] = start.normalX;
    normalY[id] = start.normalY;
    endNormalX[id] = end.normalX;
    endNormalY[id] = end.normalY;
    curvature[id] = start.curvature ?? 0;
    minX[id] = Math.min(start.x, end.x);
    maxX[id] = Math.max(start.x, end.x);
    minY[id] = Math.min(start.y, end.y);
    maxY[id] = Math.max(start.y, end.y);
  }

  return {
    segmentCount,
    startX,
    startY,
    endX,
    endY,
    startDistance,
    endDistance,
    heading,
    normalX,
    normalY,
    endNormalX,
    endNormalY,
    curvature,
    minX,
    maxX,
    minY,
    maxY,
  };
}

function createArcBuckets(totalLength, count) {
  return {
    count,
    totalLength,
    bucketLength: totalLength / count,
    buckets: Array.from({ length: count }, () => []),
  };
}

function insertSegmentIntoArcBuckets(arcBuckets, centerline, segmentId) {
  if (!Number.isFinite(arcBuckets.bucketLength) || arcBuckets.bucketLength <= 0) return;
  const start = Math.floor(centerline.startDistance[segmentId] / arcBuckets.bucketLength);
  const end = Math.floor(centerline.endDistance[segmentId] / arcBuckets.bucketLength);
  for (let bucket = start; bucket <= end; bucket += 1) {
    arcBuckets.buckets[((bucket % arcBuckets.count) + arcBuckets.count) % arcBuckets.count].push(segmentId);
  }
}

function expandedSampleBounds(samples, expansion) {
  const bounds = samples.reduce((current, point) => ({
    minX: Math.min(current.minX, point.x),
    maxX: Math.max(current.maxX, point.x),
    minY: Math.min(current.minY, point.y),
    maxY: Math.max(current.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  return {
    minX: bounds.minX - expansion,
    maxX: bounds.maxX + expansion,
    minY: bounds.minY - expansion,
    maxY: bounds.maxY + expansion,
  };
}

function createSpatialGrid(bounds, cellSize) {
  const columns = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cellSize));
  return {
    bounds,
    cellSize,
    columns,
    rows,
    cells: new Array(columns * rows),
  };
}

function insertSegmentIntoGrid(grid, centerline, segmentId, expansion) {
  insertIdIntoGridBounds(grid, segmentId, {
    minX: centerline.minX[segmentId] - expansion,
    maxX: centerline.maxX[segmentId] + expansion,
    minY: centerline.minY[segmentId] - expansion,
    maxY: centerline.maxY[segmentId] + expansion,
  });
}

function insertIdIntoGridBounds(grid, id, bounds) {
  const minCell = gridCellForPoint(grid, { x: bounds.minX, y: bounds.minY }, true);
  const maxCell = gridCellForPoint(grid, { x: bounds.maxX, y: bounds.maxY }, true);
  for (let row = minCell.row; row <= maxCell.row; row += 1) {
    for (let column = minCell.column; column <= maxCell.column; column += 1) {
      const cellIndex = row * grid.columns + column;
      const cell = grid.cells[cellIndex];
      if (cell) cell.push(id);
      else grid.cells[cellIndex] = [id];
    }
  }
}

function candidateIdsFromArcBuckets(index, distanceAlong, radius) {
  const arcBuckets = index?.arcBuckets;
  if (!arcBuckets?.count || !Number.isFinite(distanceAlong)) return [];
  const scratch = ensureQueryScratch(index);
  const segmentMarks = ensureScratchArray(scratch, 'candidateMarks', index.centerline.segmentCount);
  const candidateEpoch = nextScratchEpoch(scratch, 'candidateEpoch', segmentMarks);
  const wrapped = wrapDistance(distanceAlong, arcBuckets.totalLength);
  const center = Math.floor(wrapped / arcBuckets.bucketLength);
  const ids = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const bucket = ((center + offset) % arcBuckets.count + arcBuckets.count) % arcBuckets.count;
    for (const segmentId of arcBuckets.buckets[bucket]) {
      if (segmentMarks[segmentId] === candidateEpoch) continue;
      segmentMarks[segmentId] = candidateEpoch;
      ids.push(segmentId);
    }
  }
  return ids;
}

function candidateIdsFromGrid(index, grid, position, neighborLimit) {
  const center = gridCellForPoint(grid, position, false);
  if (!center) return [];
  const scratch = ensureQueryScratch(index);
  const maxId = Math.max(index.centerline.segmentCount, index.pit?.roadSegments?.length ?? 0, index.pit?.boxCandidates?.length ?? 0);
  const idMarks = ensureScratchArray(scratch, 'candidateMarks', maxId);
  const ids = [];
  for (let radius = 0; radius <= neighborLimit; radius += 1) {
    const candidateEpoch = nextScratchEpoch(scratch, 'candidateEpoch', idMarks);
    ids.length = 0;
    for (let row = center.row - radius; row <= center.row + radius; row += 1) {
      for (let column = center.column - radius; column <= center.column + radius; column += 1) {
        if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue;
        const cell = grid.cells[row * grid.columns + column];
        if (!cell) continue;
        for (const id of cell) {
          if (idMarks[id] === candidateEpoch) continue;
          idMarks[id] = candidateEpoch;
          ids.push(id);
        }
      }
    }
    if (ids.length) return ids.slice();
  }
  return [];
}

function candidateIdsFromGridBounds(index, grid, bounds) {
  if (
    bounds.maxX < grid.bounds.minX ||
    bounds.minX > grid.bounds.maxX ||
    bounds.maxY < grid.bounds.minY ||
    bounds.minY > grid.bounds.maxY
  ) return [];
  const minPoint = { x: bounds.minX, y: bounds.minY };
  const maxPoint = { x: bounds.maxX, y: bounds.maxY };
  const minCell = gridCellForPoint(grid, minPoint, true);
  const maxCell = gridCellForPoint(grid, maxPoint, true);
  const scratch = ensureQueryScratch(index);
  const maxId = Math.max(index.centerline.segmentCount, index.pit?.roadSegments?.length ?? 0, index.pit?.boxCandidates?.length ?? 0);
  const idMarks = ensureScratchArray(scratch, 'candidateMarks', maxId);
  const candidateEpoch = nextScratchEpoch(scratch, 'candidateEpoch', idMarks);
  const ids = [];
  for (let row = minCell.row; row <= maxCell.row; row += 1) {
    for (let column = minCell.column; column <= maxCell.column; column += 1) {
      const cell = grid.cells[row * grid.columns + column];
      if (!cell) continue;
      for (const id of cell) {
        if (idMarks[id] === candidateEpoch) continue;
        idMarks[id] = candidateEpoch;
        ids.push(id);
      }
    }
  }
  return ids;
}

function gridCellForPoint(grid, point, clampToGrid) {
  const column = Math.floor((point.x - grid.bounds.minX) / grid.cellSize);
  const row = Math.floor((point.y - grid.bounds.minY) / grid.cellSize);
  if (!clampToGrid && (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows)) return null;
  return {
    column: clampToGrid ? clamp(column, 0, grid.columns - 1) : column,
    row: clampToGrid ? clamp(row, 0, grid.rows - 1) : row,
  };
}

function projectIndexedSegment(centerline, segmentId, position) {
  const ax = centerline.startX[segmentId];
  const ay = centerline.startY[segmentId];
  const bx = centerline.endX[segmentId];
  const by = centerline.endY[segmentId];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0
    ? clamp(((position.x - ax) * dx + (position.y - ay) * dy) / lengthSquared, 0, 1)
    : 0;
  const x = ax + dx * amount;
  const y = ay + dy * amount;
  const distance = centerline.startDistance[segmentId] +
    (centerline.endDistance[segmentId] - centerline.startDistance[segmentId]) * amount;
  const heading = centerline.heading[segmentId];
  const normalX = centerline.normalX[segmentId];
  const normalY = centerline.normalY[segmentId];
  const px = position.x - x;
  const py = position.y - y;
  const signedOffset = px * normalX + py * normalY;

  return {
    segmentId,
    x,
    y,
    distance,
    heading,
    normalX,
    normalY,
    curvature: centerline.curvature[segmentId],
    signedOffset,
    crossTrackError: Math.abs(signedOffset),
    distanceSquared: px * px + py * py,
  };
}

function segmentFromIndex(centerline, segmentId) {
  return {
    segmentId,
    startX: centerline.startX[segmentId],
    startY: centerline.startY[segmentId],
    endX: centerline.endX[segmentId],
    endY: centerline.endY[segmentId],
    startDistance: centerline.startDistance[segmentId],
    endDistance: centerline.endDistance[segmentId],
    normalX: centerline.normalX[segmentId],
    normalY: centerline.normalY[segmentId],
    endNormalX: centerline.endNormalX[segmentId],
    endNormalY: centerline.endNormalY[segmentId],
  };
}

function createPitQueryIndex(track, cellSize) {
  const pitLane = track.pitLane;
  if (!pitLane?.enabled) return null;
  const bounds = {
    minX: pitLane.bounds.minX - cellSize,
    maxX: pitLane.bounds.maxX + cellSize,
    minY: pitLane.bounds.minY - cellSize,
    maxY: pitLane.bounds.maxY + cellSize,
  };
  const roadGrid = createSpatialGrid(bounds, cellSize);
  const boxGrid = createSpatialGrid(bounds, cellSize);
  const roadSegments = [];
  const routes = {};

  [
    ['entry', pitLane.entry?.roadCenterline],
    ['main', pitLane.mainLane?.points],
    ['working', pitLane.workingLane?.points],
    ['exit', pitLane.exit?.roadCenterline],
  ].forEach(([routeId, points]) => {
    routes[routeId] = { start: roadSegments.length };
    indexPitRoute(roadGrid, roadSegments, routeId, points, cellSize);
    routes[routeId].end = roadSegments.length;
  });

  const boxCandidates = [];
  [
    ...(pitLane.serviceAreas ?? []).flatMap((area) => [
      { type: 'service-area', target: area, polygon: area.corners },
      { type: 'service-queue', target: area, polygon: area.queueCorners },
    ]),
    ...(pitLane.boxes ?? []).map((box) => ({ type: 'garage-box', target: box, polygon: box.corners })),
  ]
    .filter((candidate) => Array.isArray(candidate.polygon) && candidate.polygon.length >= 3)
    .forEach((candidate) => {
      const id = boxCandidates.length;
      boxCandidates.push(candidate);
      insertIdIntoGridBounds(boxGrid, id, polygonBounds(candidate.polygon, cellSize));
    });

  return {
    roadGrid,
    boxGrid,
    routes,
    roadSegments,
    boxCandidates,
  };
}

function indexPitRoute(grid, roadSegments, routeId, points, expansion) {
  if (!Array.isArray(points) || points.length < 2) return;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const id = roadSegments.length;
    roadSegments.push({ routeId, segmentIndex: index });
    const bounds = {
      minX: Math.min(start.x, end.x) - expansion,
      maxX: Math.max(start.x, end.x) + expansion,
      minY: Math.min(start.y, end.y) - expansion,
      maxY: Math.max(start.y, end.y) + expansion,
    };
    insertIdIntoGridBounds(grid, id, bounds);
  }
}

function polygonBounds(polygon, expansion) {
  const bounds = polygon.reduce((current, point) => ({
    minX: Math.min(current.minX, point.x),
    maxX: Math.max(current.maxX, point.x),
    minY: Math.min(current.minY, point.y),
    maxY: Math.max(current.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  return {
    minX: bounds.minX - expansion,
    maxX: bounds.maxX + expansion,
    minY: bounds.minY - expansion,
    maxY: bounds.maxY + expansion,
  };
}

function createQueryScratch(index) {
  const segmentCount = Math.max(0, index?.centerline?.segmentCount ?? 0);
  const maxId = Math.max(
    segmentCount,
    index?.pit?.roadSegments?.length ?? 0,
    index?.pit?.boxCandidates?.length ?? 0,
  );
  const grid = index?.segmentGrid ?? index?.grid;
  const cellCount = Math.max(0, (grid?.columns ?? 0) * (grid?.rows ?? 0));
  return {
    candidateMarks: new Uint32Array(Math.max(1, maxId)),
    candidateEpoch: 1,
    sampleMarks: new Uint32Array(Math.max(1, segmentCount)),
    sampleEpoch: 1,
    raySegmentMarks: new Uint32Array(Math.max(1, segmentCount)),
    raySegmentEpoch: 1,
    rayCellMarks: new Uint32Array(Math.max(1, cellCount)),
    rayCellEpoch: 1,
    raySegmentIds: [],
    rayVisitedCells: [],
    rayTraceCache: new Map(),
  };
}

function ensureQueryScratch(index) {
  if (index.queryScratch) return index.queryScratch;
  index.queryScratch = createQueryScratch(index);
  return index.queryScratch;
}

function ensureScratchArray(scratch, key, minimumLength) {
  if (!scratch[key] || scratch[key].length < minimumLength) {
    scratch[key] = new Uint32Array(Math.max(1, minimumLength));
  }
  return scratch[key];
}

function nextScratchEpoch(scratch, key, marks) {
  let epoch = (scratch[key] ?? 0) + 1;
  if (epoch >= 0xFFFFFFFF) {
    marks.fill(0);
    epoch = 1;
  }
  scratch[key] = epoch;
  return epoch;
}

function seedRayTraceFromNearbyCache(
  index,
  grid,
  origin,
  vector,
  radius,
  maxDistance,
  segmentMarks,
  segmentEpoch,
  cellMarks,
  cellEpoch,
  ids,
) {
  const scratch = ensureQueryScratch(index);
  const traceCache = scratch.rayTraceCache;
  const originCell = gridCellForPoint(grid, origin, false);
  if (!originCell) return null;
  const bucket = rayTraceBucket(vector);
  const base = rayTraceBaseKey(grid, originCell, radius);
  const reuseCandidates = [bucket, bucket - 1, bucket + 1]
    .map((candidateBucket) => traceCache.get(rayTraceKey(base, candidateBucket)))
    .filter(Boolean)
    .filter((entry) => entry.maxDistance >= maxDistance * 0.85)
    .sort((a, b) => b.maxDistance - a.maxDistance);
  const seed = reuseCandidates[0];
  if (!seed) return { base, bucket };

  for (const segmentId of seed.segmentIds) {
    if (segmentMarks[segmentId] === segmentEpoch) continue;
    segmentMarks[segmentId] = segmentEpoch;
    ids.push(segmentId);
  }
  for (const cellId of seed.cellIds) {
    cellMarks[cellId] = cellEpoch;
  }
  return { base, bucket };
}

function storeRayTraceCache(index, grid, origin, vector, radius, maxDistance, segmentIds, cellIds, seed) {
  const scratch = ensureQueryScratch(index);
  const traceCache = scratch.rayTraceCache;
  const originCell = gridCellForPoint(grid, origin, false);
  if (!originCell) return;
  const bucket = seed?.bucket ?? rayTraceBucket(vector);
  const base = seed?.base ?? rayTraceBaseKey(grid, originCell, radius);
  const key = rayTraceKey(base, bucket);
  traceCache.set(key, {
    maxDistance,
    segmentIds: segmentIds.slice(),
    cellIds: cellIds.slice(),
  });
  if (traceCache.size > 96) {
    const oldestKey = traceCache.keys().next().value;
    if (oldestKey) traceCache.delete(oldestKey);
  }
}

function rayTraceBaseKey(grid, center, radius) {
  return `${center.column}:${center.row}:${radius}:${grid.columns}:${grid.rows}`;
}

function rayTraceKey(base, bucket) {
  return `${base}:${bucket}`;
}

function rayTraceBucket(vector) {
  const angleDegrees = Math.atan2(vector.y, vector.x) * 180 / Math.PI;
  return Math.round(angleDegrees / RAY_TRACE_BUCKET_DEGREES);
}

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function finiteBounds(bounds) {
  return Number.isFinite(bounds?.minX) &&
    Number.isFinite(bounds?.maxX) &&
    Number.isFinite(bounds?.minY) &&
    Number.isFinite(bounds?.maxY) &&
    bounds.minX <= bounds.maxX &&
    bounds.minY <= bounds.maxY;
}
