import { clamp, wrapDistance } from '../simMath.js';
import { metersToSimUnits } from '../units.js';

const DEFAULT_GRID_CELL_SIZE = metersToSimUnits(32);
const GRID_NEIGHBOR_LIMIT = 2;
const ARC_BUCKET_COUNT = 512;
const AMBIGUOUS_DISTANCE_EPSILON = 1e-6;

export function createTrackQueryIndex(track) {
  const samples = Array.isArray(track.samples) ? track.samples : [];
  const segmentCount = Math.max(0, samples.length - 1);
  const bands = createTrackBands(track);
  const expansion = bands.runoffEdge + (track.barrierWidth ?? 0) + metersToSimUnits(64);
  const bounds = expandedSampleBounds(samples, expansion);
  const centerline = createCenterlineSegments(samples, segmentCount);
  const grid = createSpatialGrid(bounds, DEFAULT_GRID_CELL_SIZE);
  const arcBuckets = createArcBuckets(track.length, ARC_BUCKET_COUNT);

  for (let segmentId = 0; segmentId < segmentCount; segmentId += 1) {
    insertSegmentIntoGrid(grid, centerline, segmentId, expansion);
    insertSegmentIntoArcBuckets(arcBuckets, centerline, segmentId);
  }

  return {
    version: 1,
    bands,
    centerline,
    grid,
    arcBuckets,
    pit: createPitQueryIndex(track, grid.cellSize),
    stats: {
      nearestQueries: 0,
      nearestFallbacks: 0,
      pitQueries: 0,
      pitFallbacks: 0,
    },
  };
}

export function queryNearestTrackProjection(track, position, progressHint = null) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount || !finitePoint(position)) {
    index?.stats && (index.stats.nearestFallbacks += 1);
    return null;
  }
  index.stats.nearestQueries += 1;

  const best = bestProjectionFromIndex(index, position, progressHint);
  if (!best) {
    index.stats.nearestFallbacks += 1;
    return null;
  }

  return best;
}

function bestProjectionFromIndex(index, position, progressHint) {
  const hintedCandidateIds = Number.isFinite(progressHint)
    ? candidateIdsFromArcBuckets(index.arcBuckets, progressHint, 2)
    : [];
  if (hintedCandidateIds.length) {
    const hintedBest = bestProjectionFromCandidates(index.centerline, hintedCandidateIds, position);
    const maxHintDistance = index.bands.runoffEdge + metersToSimUnits(24);
    if (hintedBest && hintedBest.distanceSquared <= maxHintDistance * maxHintDistance) return hintedBest;
  }

  const gridCandidateIds = candidateIdsFromGrid(index.grid, position, GRID_NEIGHBOR_LIMIT);
  return bestProjectionFromCandidates(index.centerline, gridCandidateIds, position);
}

function bestProjectionFromCandidates(centerline, candidateIds, position) {
  if (!candidateIds.length) return null;
  let best = null;
  let secondBestDistance = Infinity;
  for (const segmentId of candidateIds) {
    const projection = projectIndexedSegment(centerline, segmentId, position);
    if (!best || projection.distanceSquared < best.distanceSquared) {
      secondBestDistance = best?.distanceSquared ?? Infinity;
      best = projection;
    } else if (projection.distanceSquared < secondBestDistance) {
      secondBestDistance = projection.distanceSquared;
    }
  }

  if (!best) {
    return null;
  }

  const ambiguous = Number.isFinite(secondBestDistance) &&
    Math.abs(secondBestDistance - best.distanceSquared) <= AMBIGUOUS_DISTANCE_EPSILON;
  if (ambiguous) {
    return null;
  }

  return best;
}

export function queryPitBoxCandidates(track, position) {
  const index = track?.queryIndex;
  const pit = index?.pit;
  if (!pit?.boxGrid || !finitePoint(position)) return null;
  index.stats.pitQueries += 1;
  const ids = candidateIdsFromGrid(pit.boxGrid, position, 1);
  if (!ids.length) return [];
  return uniqueSorted(ids).map((id) => pit.boxCandidates[id]).filter(Boolean);
}

export function queryPitRoadSegmentCandidates(track, routeId, position) {
  const index = track?.queryIndex;
  const pit = index?.pit;
  if (!pit?.roadGrid || !finitePoint(position)) return null;
  index.stats.pitQueries += 1;
  const route = pit.routes[routeId];
  if (!route) return [];
  const ids = candidateIdsFromGrid(pit.roadGrid, position, 1);
  if (!ids.length) return [];
  return uniqueSorted(ids)
    .map((id) => pit.roadSegments[id])
    .filter((segment) => segment?.routeId === routeId)
    .map((segment) => segment.segmentIndex);
}

export function queryNearbyTrackProjections(track, position, { neighborLimit = GRID_NEIGHBOR_LIMIT } = {}) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount || !finitePoint(position)) return null;
  const ids = candidateIdsFromGrid(index.grid, position, neighborLimit);
  if (!ids.length) return [];
  return ids.map((segmentId) => projectIndexedSegment(index.centerline, segmentId, position));
}

export function queryTrackSegmentsInBounds(track, bounds) {
  const index = track?.queryIndex;
  if (!index?.centerline?.segmentCount || !finiteBounds(bounds)) return null;
  const ids = candidateIdsFromGridBounds(index.grid, bounds);
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
  return {
    bounds,
    cellSize,
    columns: Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize)),
    rows: Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cellSize)),
    cells: new Map(),
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
      const key = gridCellKey(column, row);
      const cell = grid.cells.get(key);
      if (cell) cell.push(id);
      else grid.cells.set(key, [id]);
    }
  }
}

function candidateIdsFromArcBuckets(arcBuckets, distanceAlong, radius) {
  if (!arcBuckets?.count || !Number.isFinite(distanceAlong)) return [];
  const wrapped = wrapDistance(distanceAlong, arcBuckets.totalLength);
  const center = Math.floor(wrapped / arcBuckets.bucketLength);
  const ids = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const bucket = ((center + offset) % arcBuckets.count + arcBuckets.count) % arcBuckets.count;
    ids.push(...arcBuckets.buckets[bucket]);
  }
  return uniqueSorted(ids);
}

function candidateIdsFromGrid(grid, position, neighborLimit) {
  const center = gridCellForPoint(grid, position, false);
  if (!center) return [];
  const ids = [];
  for (let radius = 0; radius <= neighborLimit; radius += 1) {
    ids.length = 0;
    for (let row = center.row - radius; row <= center.row + radius; row += 1) {
      for (let column = center.column - radius; column <= center.column + radius; column += 1) {
        if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue;
        const cell = grid.cells.get(gridCellKey(column, row));
        if (cell) ids.push(...cell);
      }
    }
    if (ids.length) return uniqueSorted(ids);
  }
  return [];
}

function candidateIdsFromGridBounds(grid, bounds) {
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
  const ids = [];
  for (let row = minCell.row; row <= maxCell.row; row += 1) {
    for (let column = minCell.column; column <= maxCell.column; column += 1) {
      const cell = grid.cells.get(gridCellKey(column, row));
      if (cell) ids.push(...cell);
    }
  }
  return uniqueSorted(ids);
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

function gridCellKey(column, row) {
  return `${column}:${row}`;
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
    insertIdIntoGridBounds(grid, id, {
      minX: Math.min(start.x, end.x) - expansion,
      maxX: Math.max(start.x, end.x) + expansion,
      minY: Math.min(start.y, end.y) - expansion,
      maxY: Math.max(start.y, end.y) + expansion,
    });
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

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
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
