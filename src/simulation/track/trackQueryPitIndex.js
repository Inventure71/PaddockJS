import { createSpatialGrid, insertIdIntoGridBounds, candidateIdsFromGrid } from './trackQueryGrid.js';
import { recordFallback, recordStat } from './trackQueryStats.js';

const PIT_ROAD_GRID_NEIGHBOR_LIMIT = 1;
const PIT_ROAD_ENDPOINT_SEGMENT_COUNT = 4;

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
    routes[routeId] = {
      start: roadSegments.length,
      cumulativeDistances: createRouteCumulativeDistances(points),
      ...createRouteEndpointSegmentWindows(points),
    };
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

export function queryPitBoxCandidates(track, position, scratch = null) {
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
    if (scratch) {
      const empty = scratch.pitBoxCandidates ?? [];
      scratch.pitBoxCandidates = empty;
      empty.length = 0;
      return empty;
    }
    return [];
  }
  recordStat(index, 'pitPaths', 'box-grid-hit');
  const candidates = scratch ? (scratch.pitBoxCandidates ??= []) : [];
  candidates.length = 0;
  ids.forEach((id) => {
    const candidate = pit.boxCandidates[id];
    if (candidate) candidates.push(candidate);
  });
  return scratch ? candidates : [...candidates];
}

export function queryPitRoadSegmentCandidates(track, routeId, position, scratch = null) {
  const candidatesByRoute = queryPitRoadSegmentCandidatesByRoute(track, position, null, scratch);
  return candidatesByRoute?.[routeId] ?? candidatesByRoute;
}

export function queryPitRoadSegmentCandidatesByRoute(
  track,
  position,
  progressHintOrScratch = null,
  scratchArg = null,
  options = {},
) {
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
  const progressHint = Number.isFinite(progressHintOrScratch)
    ? progressHintOrScratch
    : null;
  const scratch = progressHint === null && scratchArg == null && progressHintOrScratch && typeof progressHintOrScratch === 'object'
    ? progressHintOrScratch
    : scratchArg;
  if (options.countQuery !== false) index.stats.pitQueries += 1;
  const ids = candidateIdsFromGrid(index, pit.roadGrid, position, PIT_ROAD_GRID_NEIGHBOR_LIMIT);
  const candidatesByRoute = scratch
    ? (scratch.pitRouteCandidates ??= { entry: [], main: [], working: [], exit: [] })
    : { entry: [], main: [], working: [], exit: [] };
  candidatesByRoute.entry.length = 0;
  candidatesByRoute.main.length = 0;
  candidatesByRoute.working.length = 0;
  candidatesByRoute.exit.length = 0;
  ids.forEach((id) => {
    const segment = pit.roadSegments[id];
    if (!segment || !candidatesByRoute[segment.routeId]) return;
    candidatesByRoute[segment.routeId].push(segment.segmentIndex);
  });
  const recordPathStats = options.recordPathStats !== false;
  const endpointAugmented = appendEndpointSegmentsForProgress(track, candidatesByRoute, progressHint);
  const hasAnyCandidates = (
    candidatesByRoute.entry.length +
    candidatesByRoute.main.length +
    candidatesByRoute.working.length +
    candidatesByRoute.exit.length
  ) > 0;
  if (!hasAnyCandidates) {
    if (recordPathStats) recordStat(index, 'pitPaths', 'road-grid-miss');
    return null;
  }
  if (recordPathStats) recordStat(index, 'pitPaths', ids.length ? 'road-grid-hit' : 'road-grid-endpoint-hit');
  if (recordPathStats && endpointAugmented) {
    recordStat(index, 'pitPaths', 'road-endpoint-window-hit');
  }
  return candidatesByRoute;
}

function appendEndpointSegmentsForProgress(track, candidatesByRoute, progressHint) {
  if (!Number.isFinite(progressHint)) return false;
  const pit = track?.queryIndex?.pit;
  const pitLane = track?.pitLane;
  if (!pit?.routes || !pitLane?.enabled) return false;
  let augmented = false;
  if (progressHint >= pitLane.entry.trackDistance) {
    augmented = appendRouteEndpointSegments(
      candidatesByRoute.entry,
      pit.routes.entry,
      'start',
    ) || augmented;
  }
  if (progressHint <= pitLane.exit.trackDistance) {
    augmented = appendRouteEndpointSegments(
      candidatesByRoute.exit,
      pit.routes.exit,
      'end',
    ) || augmented;
  }
  return augmented;
}

function appendRouteEndpointSegments(target, route, edge) {
  if (!Array.isArray(target) || !route) return false;
  const beforeLength = target.length;
  if (edge === 'start') {
    const limit = Math.min(route.end, route.start + PIT_ROAD_ENDPOINT_SEGMENT_COUNT);
    for (let id = route.start; id < limit; id += 1) {
      const segmentIndex = id - route.start;
      if (!target.includes(segmentIndex)) target.push(segmentIndex);
    }
  } else {
    const limit = Math.max(route.start, route.end - PIT_ROAD_ENDPOINT_SEGMENT_COUNT);
    for (let id = limit; id < route.end; id += 1) {
      const segmentIndex = id - route.start;
      if (!target.includes(segmentIndex)) target.push(segmentIndex);
    }
  }
  return target.length > beforeLength;
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

function createRouteCumulativeDistances(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const distances = new Array(points.length);
  distances[0] = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    distances[index] = distances[index - 1] + Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return distances;
}

function createRouteEndpointSegmentWindows(points) {
  const segmentCount = Array.isArray(points) ? Math.max(0, points.length - 1) : 0;
  const startSegmentWindow = [];
  const endSegmentWindow = [];
  const endpointSegmentWindow = [];
  const startLimit = Math.min(segmentCount, PIT_ROAD_ENDPOINT_SEGMENT_COUNT);
  const endStart = Math.max(0, segmentCount - PIT_ROAD_ENDPOINT_SEGMENT_COUNT);
  for (let index = 0; index < startLimit; index += 1) {
    startSegmentWindow.push(index);
    endpointSegmentWindow.push(index);
  }
  for (let index = endStart; index < segmentCount; index += 1) {
    endSegmentWindow.push(index);
    if (!endpointSegmentWindow.includes(index)) endpointSegmentWindow.push(index);
  }
  return {
    startSegmentWindow,
    endSegmentWindow,
    endpointSegmentWindow,
  };
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
