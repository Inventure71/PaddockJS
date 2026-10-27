import { metersToSimUnits } from '../units.js';
import { clamp } from '../simMath.js';
import { createSpatialGrid, gridCellForPoint, insertIdIntoGridBounds } from './trackQueryGrid.js';
import { createPitQueryIndex } from './trackQueryPitIndex.js';
import { createQueryScratch } from './trackQueryScratch.js';
import { createQueryStats } from './trackQueryStats.js';
import { createCenterlineSegments, createPrecomputedSegmentNeighborhoods } from './trackQuerySegments.js';
import { AMBIGUOUS_DISTANCE_EPSILON, HINTED_RUNOFF_WIDE_SEGMENT_RADIUS, LOW_DENSITY_HINT_RING1_SEGMENT_THRESHOLD } from './trackQueryConstants.js';

const DEFAULT_GRID_CELL_SIZE = metersToSimUnits(32);
const ARC_BUCKET_COUNT = 512;
const PRECOMPUTED_SEGMENT_NEIGHBORHOOD_RADII = new Set([2, HINTED_RUNOFF_WIDE_SEGMENT_RADIUS]);

export function createTrackQueryIndex(track) {
  const samples = Array.isArray(track.samples) ? track.samples : [];
  const segmentCount = Math.max(0, samples.length - 1);
  const bands = createTrackBands(track);
  const expansion = bands.runoffEdge + (track.barrierWidth ?? 0) + metersToSimUnits(64);
  const bounds = expandedSampleBounds(samples, expansion);
  const centerline = createCenterlineSegments(samples, segmentCount);
  centerline.precomputedNeighborhoodsByRadius = createPrecomputedSegmentNeighborhoods(segmentCount, PRECOMPUTED_SEGMENT_NEIGHBORHOOD_RADII);
  const grid = createSpatialGrid(bounds, DEFAULT_GRID_CELL_SIZE);
  const segmentGrid = createSpatialGrid(bounds, DEFAULT_GRID_CELL_SIZE);
  const arcBuckets = createArcBuckets(track.length, ARC_BUCKET_COUNT);

  for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
    insertSegmentIntoGrid(grid, centerline, segmentId, expansion);
    insertSegmentIntoGrid(segmentGrid, centerline, segmentId, 0);
    insertSegmentIntoArcBuckets(arcBuckets, centerline, segmentId);
  }
  finalizeArcBuckets(arcBuckets, segmentCount);

  const lowDensityHintRing1Neighborhood = createLowDensityHintRing1Neighborhood(centerline, segmentGrid, LOW_DENSITY_HINT_RING1_SEGMENT_THRESHOLD);
  const index = {
    version: 1,
    bands,
    nearestGridExpansion: expansion,
    centerline,
    grid,
    segmentGrid,
    arcBuckets,
    nearestOccupiedCellRadiusByCell: createNearestOccupiedCellRadiusByCell(segmentGrid),
    nearestNonLocalHintDistanceSquared: createNearestNonLocalHintDistanceSquared(centerline, segmentGrid, bands.kerbEdge * 2),
    lowDensityHintRing1SegmentCounts: lowDensityHintRing1Neighborhood.counts,
    lowDensityHintRing1CandidateIdsByCell: lowDensityHintRing1Neighborhood.candidateIdsByCell,
    pit: createPitQueryIndex(track, grid.cellSize),
    stats: createQueryStats(),
  };
  attachQueryStatsToCenterline(centerline, index.stats);
  index.queryScratch = createQueryScratch(index);
  return index;
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

export function forkTrackQueryIndex(sourceIndex, runtimeTrack = null) {
  if (!sourceIndex || typeof sourceIndex !== 'object') return null;
  const index = {
    ...sourceIndex,
    centerline: { ...sourceIndex.centerline },
    pit: runtimeTrack ? createPitQueryIndex(runtimeTrack, sourceIndex.grid?.cellSize ?? DEFAULT_GRID_CELL_SIZE) : sourceIndex.pit,
    stats: createQueryStats(),
  };
  attachQueryStatsToCenterline(index.centerline, index.stats);
  Object.freeze(index.centerline);
  index.queryScratch = createQueryScratch(index);
  return index;
}

function attachQueryStatsToCenterline(centerline, stats) {
  const descriptor = Object.getOwnPropertyDescriptor(centerline, 'stats');
  if (!descriptor) {
    Object.defineProperty(centerline, 'stats', {
      configurable: true,
      enumerable: false,
      value: stats,
      writable: true,
    });
    return;
  }
  if (descriptor.writable) centerline.stats = stats;
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

function createArcBuckets(totalLength, count) {
  return {
    count,
    totalLength,
    bucketLength: totalLength / count,
    buckets: Array.from({ length: count }, () => []),
    radius2CandidateIdsByBucket: Array.from({ length: count }, () => []),
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

function finalizeArcBuckets(arcBuckets, segmentCount) {
  if (!arcBuckets?.count || !segmentCount) return;
  const candidateMarks = new Uint32Array(Math.max(1, segmentCount));
  let epoch = 0;
  for (let center = 0; center < arcBuckets.count; center += 1) {
    epoch += 1;
    if (epoch === 0xffffffff) {
      candidateMarks.fill(0);
      epoch = 1;
    }
    const candidateIds = [];
    for (let offset = -2; offset <= 2; offset += 1) {
      const bucket = ((center + offset) % arcBuckets.count + arcBuckets.count) % arcBuckets.count;
      for (const segmentId of arcBuckets.buckets[bucket]) {
        if (candidateMarks[segmentId] === epoch) continue;
        candidateMarks[segmentId] = epoch;
        candidateIds.push(segmentId);
      }
    }
    arcBuckets.radius2CandidateIdsByBucket[center] = candidateIds;
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

function createNearestNonLocalHintDistanceSquared(centerline, grid, maxDistance) {
  const segmentCount = centerline?.segmentCount ?? 0;
  const distances = new Float64Array(segmentCount);
  distances.fill(Infinity);
  if (!segmentCount || !grid) return distances;
  const candidateMarks = new Uint32Array(Math.max(1, segmentCount));
  let epoch = 0;
  const maxDistanceSquared = maxDistance * maxDistance;
  for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
    epoch += 1;
    if (epoch === 0xffffffff) {
      candidateMarks.fill(0);
      epoch = 1;
    }
    const bounds = {
      minX: centerline.minX[segmentId] - maxDistance,
      maxX: centerline.maxX[segmentId] + maxDistance,
      minY: centerline.minY[segmentId] - maxDistance,
      maxY: centerline.maxY[segmentId] + maxDistance,
    };
    const minCell = gridCellForPoint(grid, { x: bounds.minX, y: bounds.minY }, true);
    const maxCell = gridCellForPoint(grid, { x: bounds.maxX, y: bounds.maxY }, true);
    let bestDistanceSquared = Infinity;
    for (let row = minCell.row; row <= maxCell.row; row += 1) {
      for (let column = minCell.column; column <= maxCell.column; column += 1) {
        const cell = grid.cells[row * grid.columns + column];
        if (!cell) continue;
        for (const candidateId of cell) {
          if (candidateMarks[candidateId] === epoch) continue;
          candidateMarks[candidateId] = epoch;
          if (isLocalSegmentNeighbor(segmentId, candidateId, segmentCount, 2)) continue;
          const candidateDistanceSquared = segmentDistanceSquared(centerline, segmentId, candidateId);
          if (candidateDistanceSquared < bestDistanceSquared) {
            bestDistanceSquared = candidateDistanceSquared;
          }
          if (bestDistanceSquared <= AMBIGUOUS_DISTANCE_EPSILON) {
            break;
          }
        }
        if (bestDistanceSquared <= AMBIGUOUS_DISTANCE_EPSILON) break;
      }
      if (bestDistanceSquared <= AMBIGUOUS_DISTANCE_EPSILON) break;
    }
    distances[segmentId] = bestDistanceSquared <= maxDistanceSquared ? bestDistanceSquared : Infinity;
  }
  return distances;
}

function createLowDensityHintRing1Neighborhood(centerline, grid, threshold) {
  const cellCount = grid?.columns * grid?.rows;
  if (!centerline?.segmentCount || !grid || !Number.isInteger(cellCount) || cellCount <= 0) {
    return {
      counts: new Uint16Array(0),
      candidateIdsByCell: [],
    };
  }
  const counts = new Uint16Array(cellCount);
  const candidateIdsByCell = new Array(cellCount).fill(null);
  const candidateMarks = new Uint32Array(Math.max(1, centerline.segmentCount));
  let epoch = 0;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      epoch += 1;
      if (epoch === 0xffffffff) {
        candidateMarks.fill(0);
        epoch = 1;
      }
      let uniqueCount = 0;
      const ids = [];
      for (let localRow = Math.max(0, row - 1); localRow <= Math.min(grid.rows - 1, row + 1); localRow += 1) {
        for (
          let localColumn = Math.max(0, column - 1);
          localColumn <= Math.min(grid.columns - 1, column + 1);
          localColumn += 1
        ) {
          const cell = grid.cells[localRow * grid.columns + localColumn];
          if (!cell) continue;
          for (const segmentId of cell) {
            if (candidateMarks[segmentId] === epoch) continue;
            candidateMarks[segmentId] = epoch;
            uniqueCount += 1;
            ids.push(segmentId);
          }
        }
      }
      const cellIndex = row * grid.columns + column;
      counts[cellIndex] = uniqueCount;
      if (uniqueCount <= threshold) {
        candidateIdsByCell[cellIndex] = ids;
      }
    }
  }
  return { counts, candidateIdsByCell };
}

function createNearestOccupiedCellRadiusByCell(grid) {
  const cellCount = grid?.columns * grid?.rows;
  if (!grid || !Number.isInteger(cellCount) || cellCount <= 0) {
    return new Uint16Array(0);
  }
  const radii = new Uint16Array(cellCount);
  radii.fill(0xffff);
  const queue = new Uint32Array(cellCount);
  let head = 0;
  let tail = 0;

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    if (!grid.cells[cellIndex]?.length) continue;
    radii[cellIndex] = 0;
    queue[tail] = cellIndex;
    tail += 1;
  }

  while (head < tail) {
    const cellIndex = queue[head];
    head += 1;
    const row = Math.floor(cellIndex / grid.columns);
    const column = cellIndex - row * grid.columns;
    const nextRadius = radii[cellIndex] + 1;

    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      const neighborRow = row + rowOffset;
      if (neighborRow < 0 || neighborRow >= grid.rows) continue;
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        const neighborColumn = column + columnOffset;
        if (neighborColumn < 0 || neighborColumn >= grid.columns) continue;
        const neighborIndex = neighborRow * grid.columns + neighborColumn;
        if (radii[neighborIndex] <= nextRadius) continue;
        radii[neighborIndex] = nextRadius;
        queue[tail] = neighborIndex;
        tail += 1;
      }
    }
  }

  return radii;
}

function isLocalSegmentNeighbor(segmentId, candidateId, segmentCount, radius) {
  const delta = Math.abs(segmentId - candidateId);
  return Math.min(delta, segmentCount - delta) <= radius;
}

function segmentDistanceSquared(centerline, firstSegmentId, secondSegmentId) {
  const ax = centerline.startX[firstSegmentId];
  const ay = centerline.startY[firstSegmentId];
  const bx = centerline.endX[firstSegmentId];
  const by = centerline.endY[firstSegmentId];
  const cx = centerline.startX[secondSegmentId];
  const cy = centerline.startY[secondSegmentId];
  const dx = centerline.endX[secondSegmentId];
  const dy = centerline.endY[secondSegmentId];

  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;

  return Math.min(
    pointToSegmentDistanceSquared(ax, ay, cx, cy, dx, dy),
    pointToSegmentDistanceSquared(bx, by, cx, cy, dx, dy),
    pointToSegmentDistanceSquared(cx, cy, ax, ay, bx, by),
    pointToSegmentDistanceSquared(dx, dy, ax, ay, bx, by),
  );
}

function pointToSegmentDistanceSquared(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0
    ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1)
    : 0;
  const x = ax + dx * amount;
  const y = ay + dy * amount;
  const deltaX = px - x;
  const deltaY = py - y;
  return deltaX * deltaX + deltaY * deltaY;
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const abx = bx - ax;
  const aby = by - ay;
  const acx = cx - ax;
  const acy = cy - ay;
  const adx = dx - ax;
  const ady = dy - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const cax = ax - cx;
  const cay = ay - cy;
  const cbx = bx - cx;
  const cby = by - cy;
  const cross1 = abx * acy - aby * acx;
  const cross2 = abx * ady - aby * adx;
  const cross3 = cdx * cay - cdy * cax;
  const cross4 = cdx * cby - cdy * cbx;
  return cross1 * cross2 <= 0 && cross3 * cross4 <= 0;
}
