import { clamp, wrapDistance } from '../simMath.js';
import { metersToSimUnits } from '../units.js';
import {
  candidateIdsFromGrid,
  candidateIdsFromGridBounds,
  createSpatialGrid,
  gridCellForPoint,
  insertIdIntoGridBounds,
} from './trackQueryGrid.js';
import { createPitQueryIndex } from './trackQueryPitIndex.js';
import { createQueryScratch, ensureQueryScratch, ensureScratchArray, nextScratchEpoch } from './trackQueryScratch.js';
import { createQueryStats, recordFallback, recordStat } from './trackQueryStats.js';

export {
  queryPitBoxCandidates,
  queryPitRoadSegmentCandidates,
  queryPitRoadSegmentCandidatesByRoute,
} from './trackQueryPitIndex.js';

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
    nearestGridExpansion: expansion,
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

export function queryNearestTrackProjection(track, position, progressHint = null) {
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

  const { projection, path, reason } = bestProjectionFromIndex(index, position, progressHint);
  if (!projection) {
    recordFallback(index, 'nearestFallbackReasons', reason ?? 'unknown');
    return null;
  }

  recordStat(index, 'nearestPaths', path);
  return projection;
}

function bestProjectionFromIndex(index, position, progressHint) {
  const hintedCandidateIds = Number.isFinite(progressHint)
    ? candidateIdsFromArcBuckets(index, progressHint, 2)
    : [];
  if (hintedCandidateIds.length) {
    const hinted = bestProjectionFromCandidates(index.centerline, hintedCandidateIds, position, progressHint);
    if (hinted.projection) {
      const exact = bestProjectionFromCellSearch(index, position, progressHint, hinted.projection);
      if (exact.projection) {
        const path = projectionMatches(hinted.projection, exact.projection)
          ? (hinted.reason === 'tie-resolved' ? 'arc-hint-tie-resolved' : 'arc-hint')
          : 'arc-hint-refined';
        return {
          projection: exact.projection,
          path: exact.reason === 'tie-resolved' && !path.endsWith('tie-resolved') ? `${path}-tie-resolved` : path,
        };
      }
    }
  }

  let local = { projection: null, path: null };
  const gridCandidateIds = candidateIdsFromGrid(index, index.grid, position, GRID_NEIGHBOR_LIMIT);
  const grid = bestProjectionFromCandidates(index.centerline, gridCandidateIds, position, progressHint);
  if (grid.projection) {
    local = chooseBetterProjectionResult(local, grid, 'spatial-grid', progressHint);
    if (grid.projection.distanceSquared <= index.nearestGridExpansion * index.nearestGridExpansion) {
      return local;
    }
  }

  if (local.projection) {
    const exact = bestProjectionFromCellSearch(index, position, progressHint, local.projection);
    if (exact.projection) {
      const path = projectionMatches(local.projection, exact.projection)
        ? local.path
        : `${local.path}-refined`;
      return {
        projection: exact.projection,
        path: exact.reason === 'tie-resolved' && !path.endsWith('tie-resolved') ? `${path}-tie-resolved` : path,
      };
    }

    return {
      projection: local.projection,
      path: local.path,
    };
  }

  const exact = bestProjectionFromCellSearch(index, position, progressHint);
  const global = exact.projection ? exact : bestProjectionFromAllSegments(index.centerline, position, progressHint);
  return global.projection
    ? {
      projection: global.projection,
      path: exact.projection
        ? (global.reason === 'tie-resolved' ? 'exact-grid-tie-resolved' : 'exact-grid')
        : (global.reason === 'tie-resolved' ? 'global-index-tie-resolved' : 'global-index'),
    }
    : { projection: null, reason: `global-index-${global.reason}` };
}

function chooseBetterProjectionResult(current, candidate, source, preferredDistance) {
  if (!candidate.projection) return current;
  const path = candidate.reason === 'tie-resolved' ? `${source}-tie-resolved` : source;
  if (!current.projection) return { projection: candidate.projection, path };
  if (candidate.projection.distanceSquared < current.projection.distanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
    return { projection: candidate.projection, path };
  }
  if (Math.abs(candidate.projection.distanceSquared - current.projection.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
    const candidateTie = projectionTieScore(candidate.projection, preferredDistance);
    const currentTie = projectionTieScore(current.projection, preferredDistance);
    if (projectionTieBeats(candidate.projection, candidateTie, current.projection, currentTie)) {
      return { projection: candidate.projection, path: `${path}-tie-resolved` };
    }
  }
  return current;
}

function bestProjectionFromCellSearch(index, position, preferredDistance, initialProjection = null) {
  const grid = index.segmentGrid ?? index.grid;
  const center = gridCellForPoint(grid, position, true);

  const scratch = ensureQueryScratch(index);
  const segmentMarks = ensureScratchArray(scratch, 'exactSegmentMarks', index.centerline.segmentCount);
  const cellMarks = ensureScratchArray(scratch, 'exactCellMarks', grid.columns * grid.rows);
  const segmentEpoch = nextScratchEpoch(scratch, 'exactSegmentEpoch', segmentMarks);
  const cellEpoch = nextScratchEpoch(scratch, 'exactCellEpoch', cellMarks);
  const maxRadius = Math.max(grid.columns, grid.rows);
  let best = initialProjection;
  let bestTieScore = best ? projectionTieScore(best, preferredDistance) : Infinity;
  let secondBestDistance = Infinity;
  let tieResolved = false;

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    let ringCanImprove = !best;

    forEachRingCell(grid, center, radius, (cellIndex, row, column) => {
      if (cellMarks[cellIndex] === cellEpoch) return;
      cellMarks[cellIndex] = cellEpoch;
      const lowerBound = cellDistanceSquared(grid, row, column, position);
      if (best && lowerBound > best.distanceSquared + AMBIGUOUS_DISTANCE_EPSILON) {
        return;
      }
      ringCanImprove = true;
      const cell = grid.cells[cellIndex];
      if (!cell) return;
      for (const segmentId of cell) {
        if (segmentMarks[segmentId] === segmentEpoch) continue;
        segmentMarks[segmentId] = segmentEpoch;
        const projection = projectIndexedSegment(index.centerline, segmentId, position);
        const tieScore = projectionTieScore(projection, preferredDistance);
        if (!best || projection.distanceSquared < best.distanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
          secondBestDistance = best?.distanceSquared ?? Infinity;
          best = projection;
          bestTieScore = tieScore;
        } else if (Math.abs(projection.distanceSquared - best.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
          tieResolved = true;
          secondBestDistance = Math.min(secondBestDistance, projection.distanceSquared);
          if (projectionTieBeats(projection, tieScore, best, bestTieScore)) {
            best = projection;
            bestTieScore = tieScore;
          }
        } else if (projection.distanceSquared < secondBestDistance) {
          secondBestDistance = projection.distanceSquared;
        }
      }
    });
    if (best && !ringCanImprove) break;
  }

  if (!best) return { projection: null, reason: 'no-candidates' };
  const ambiguous = Number.isFinite(secondBestDistance) &&
    Math.abs(secondBestDistance - best.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
  return { projection: best, reason: ambiguous || tieResolved ? 'tie-resolved' : 'ok' };
}

function projectionMatches(first, second) {
  return first.segmentId === second.segmentId &&
    Math.abs(first.distanceSquared - second.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
}

function forEachRingCell(grid, center, radius, visitor) {
  const minRow = Math.max(0, center.row - radius);
  const maxRow = Math.min(grid.rows - 1, center.row + radius);
  const minColumn = Math.max(0, center.column - radius);
  const maxColumn = Math.min(grid.columns - 1, center.column + radius);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      if (
        radius > 0 &&
        row !== minRow &&
        row !== maxRow &&
        column !== minColumn &&
        column !== maxColumn
      ) continue;
      visitor(row * grid.columns + column, row, column);
    }
  }
}

function cellDistanceSquared(grid, row, column, position) {
  const minX = grid.bounds.minX + column * grid.cellSize;
  const minY = grid.bounds.minY + row * grid.cellSize;
  const maxX = Math.min(grid.bounds.maxX, minX + grid.cellSize);
  const maxY = Math.min(grid.bounds.maxY, minY + grid.cellSize);
  const dx = position.x < minX ? minX - position.x : position.x > maxX ? position.x - maxX : 0;
  const dy = position.y < minY ? minY - position.y : position.y > maxY ? position.y - maxY : 0;
  return dx * dx + dy * dy;
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
      if (projectionTieBeats(projection, tieScore, best, bestTieScore)) {
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

function bestProjectionFromAllSegments(centerline, position, preferredDistance = null) {
  const segmentCount = centerline?.segmentCount ?? 0;
  if (segmentCount <= 0) return { projection: null, reason: 'no-candidates' };
  let best = null;
  let bestTieScore = Infinity;
  let secondBestDistance = Infinity;
  let tieResolved = false;

  for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
    const projection = projectIndexedSegment(centerline, segmentId, position);
    const tieScore = projectionTieScore(projection, preferredDistance);
    if (!best || projection.distanceSquared < best.distanceSquared - AMBIGUOUS_DISTANCE_EPSILON) {
      secondBestDistance = best?.distanceSquared ?? Infinity;
      best = projection;
      bestTieScore = tieScore;
    } else if (Math.abs(projection.distanceSquared - best.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON) {
      tieResolved = true;
      secondBestDistance = Math.min(secondBestDistance, projection.distanceSquared);
      if (projectionTieBeats(projection, tieScore, best, bestTieScore)) {
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

function projectionTieBeats(candidate, candidateTieScore, current, currentTieScore) {
  if (candidateTieScore < currentTieScore - AMBIGUOUS_DISTANCE_EPSILON) return true;
  if (Math.abs(candidateTieScore - currentTieScore) > AMBIGUOUS_DISTANCE_EPSILON) return false;
  return candidate.segmentId < current.segmentId;
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

function insertSegmentIntoGrid(grid, centerline, segmentId, expansion) {
  insertIdIntoGridBounds(grid, segmentId, {
    minX: centerline.minX[segmentId] - expansion,
    maxX: centerline.maxX[segmentId] + expansion,
    minY: centerline.minY[segmentId] - expansion,
    maxY: centerline.maxY[segmentId] + expansion,
  });
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
