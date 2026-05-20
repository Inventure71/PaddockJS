import { createSpatialGrid, insertIdIntoGridBounds, candidateIdsFromGrid } from './trackQueryGrid.js';
import { recordFallback, recordStat } from './trackQueryStats.js';

export function createPitQueryIndex(track, cellSize) {
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

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}
