import { gridCellForPoint } from './trackQueryGrid.js';
import { ensureQueryScratch, ensureScratchArray, nextScratchEpoch } from './trackQueryScratch.js';
import { segmentFromIndex } from './trackQuerySegments.js';
import { finitePoint } from './trackMath.js';

const RAY_TRACE_BUCKET_DEGREES = 10;

export function queryTrackSegmentIdsAlongRay(track, origin, vector, maxDistance, margin = 0) {
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
  const point = scratch.rayTracePoint ?? { x: 0, y: 0 };
  scratch.rayTracePoint = point;

  const seed = seedRayTraceFromNearbyCache(index, grid, origin, vector, radius, maxDistance, segmentMarks, segmentEpoch, cellMarks, cellEpoch, ids);

  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const distance = Math.min(maxDistance, sample * step);
    point.x = origin.x + vector.x * distance;
    point.y = origin.y + vector.y * distance;
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
  return ids;
}

export function queryTrackSegmentsAlongRay(track, origin, vector, maxDistance, margin = 0) {
  const index = track?.queryIndex;
  const ids = queryTrackSegmentIdsAlongRay(track, origin, vector, maxDistance, margin);
  if (!ids) return null;
  if (!ids.length) return [];
  return ids.map((segmentId) => segmentFromIndex(index.centerline, segmentId));
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
  const minimumSeedDistance = maxDistance * 0.85;
  let seed = traceCache.get(rayTraceKey(base, bucket));
  let bestSeedDistance = seed?.maxDistance ?? -Infinity;
  if (bestSeedDistance < minimumSeedDistance) {
    seed = null;
    bestSeedDistance = -Infinity;
  }
  const beforeSeed = traceCache.get(rayTraceKey(base, bucket - 1));
  if ((beforeSeed?.maxDistance ?? -Infinity) >= minimumSeedDistance && beforeSeed.maxDistance > bestSeedDistance) {
    seed = beforeSeed;
    bestSeedDistance = beforeSeed.maxDistance;
  }
  const afterSeed = traceCache.get(rayTraceKey(base, bucket + 1));
  if ((afterSeed?.maxDistance ?? -Infinity) >= minimumSeedDistance && afterSeed.maxDistance > bestSeedDistance) {
    seed = afterSeed;
  }
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
  let entry = traceCache.get(key);
  if (!entry) {
    entry = {
      maxDistance: 0,
      segmentIds: [],
      cellIds: [],
    };
    traceCache.set(key, entry);
    if (index.stats) index.stats.rayTraceCacheEntryAllocations += 1;
  }
  entry.maxDistance = maxDistance;
  entry.segmentIds.length = segmentIds.length;
  for (let index = 0; index < segmentIds.length; index += 1) {
    entry.segmentIds[index] = segmentIds[index];
  }
  entry.cellIds.length = cellIds.length;
  for (let index = 0; index < cellIds.length; index += 1) {
    entry.cellIds[index] = cellIds[index];
  }
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
