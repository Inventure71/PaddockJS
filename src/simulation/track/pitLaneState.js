import { clamp, wrapDistance } from '../simMath.js';
import { nearestPointOnPolyline, nearestPointOnPolylineInto, pointInsideBounds, pointIsInsidePolygon } from './trackMath.js';
import { queryPitBoxCandidates, queryPitRoadSegmentCandidatesByRoute } from './trackQueryIndex.js';
import { ensureQueryScratch } from './trackQueryScratch.js';

export function mapPitDistance(track, startDistance, endDistance, amount) {
  return wrapDistance(startDistance + (endDistance - startDistance) * clamp(amount, 0, 1), track.length);
}

export function createPitRoadState(track, position, pitLane, {
  points,
  surface,
  part,
  roadWidth,
  startDistance,
  endDistance,
  segmentCandidates = null,
  projectionTarget = null,
  projectionScratch = null,
  cumulativeDistances = null,
  connectorProjectionStats = false,
  connectorEndpointWindowProjection = false,
}) {
  if (!Array.isArray(points) || points.length < 2) return null;
  if (Array.isArray(segmentCandidates) && segmentCandidates.length === 0) return null;
  if (connectorProjectionStats) {
    const stats = track?.queryIndex?.stats;
    if (stats) {
      if (connectorEndpointWindowProjection && Array.isArray(segmentCandidates) && segmentCandidates.length > 0) {
        stats.pitConnectorEndpointWindowProjectionCalls =
          (stats.pitConnectorEndpointWindowProjectionCalls ?? 0) + 1;
      } else if (!Array.isArray(segmentCandidates)) {
        stats.pitConnectorFullRouteProjectionScans =
          (stats.pitConnectorFullRouteProjectionScans ?? 0) + 1;
      }
    }
  }
  if (projectionScratch && Array.isArray(segmentCandidates) && segmentCandidates.length > 0 && !Array.isArray(cumulativeDistances)) {
    const stats = track?.queryIndex?.stats;
    if (stats) stats.pitRoadCumulativeDistanceRebuilds = (stats.pitRoadCumulativeDistanceRebuilds ?? 0) + 1;
  }
  const projected = projectionTarget
    ? nearestPointOnPolylineInto(projectionTarget, points, position, {
      segmentIndices: segmentCandidates,
      scratch: projectionScratch,
      cumulativeDistances,
    })
    : nearestPointOnPolyline(points, position, segmentCandidates);
  if (!projected || projected.crossTrackError > roadWidth / 2) return null;
  const amount = projected.totalLength > 0 ? projected.distanceAlong / projected.totalLength : 0;
  const distanceAlongTrack = mapPitDistance(track, startDistance, endDistance, amount);

  return {
    x: projected.point.x,
    y: projected.point.y,
    heading: projected.heading,
    normalX: projected.normalX,
    normalY: projected.normalY,
    curvature: 0,
    distance: distanceAlongTrack,
    signedOffset: projected.signedOffset,
    crossTrackError: projected.crossTrackError,
    surface,
    onTrack: true,
    inPitLane: true,
    pitLanePart: part,
    pitLaneSignedOffset: projected.signedOffset,
    pitLaneCrossTrackError: projected.crossTrackError,
    pitLaneDistanceAlong: projected.distanceAlong,
    pitLaneTotalLength: projected.totalLength,
    pitLaneRouteAmount: amount,
    pitLaneRoadWidth: roadWidth,
  };
}

export function createPitBoxState(track, position, pitLane, candidateBoxes = null) {
  const candidates = Array.isArray(candidateBoxes) ? candidateBoxes : createLegacyPitBoxCandidates(pitLane);
  const serviceMatch = candidates.find((candidate) => (
    (candidate.type === 'service-area' || candidate.type === 'service-queue') &&
    pointIsInsidePolygon(position, candidate.polygon)
  ));
  const garageMatch = serviceMatch ? null : candidates.find((candidate) => (
    candidate.type === 'garage-box' &&
    pointIsInsidePolygon(position, candidate.polygon)
  ));
  const serviceArea = serviceMatch?.target ?? null;
  const box = serviceArea ?? garageMatch?.target ?? null;
  if (!box) return null;
  const distanceAmount = pitLane.mainLane.length > 0
    ? box.distanceAlongLane / pitLane.mainLane.length
    : 0;
  const distanceAlongTrack = mapPitDistance(
    track,
    pitLane.layout?.entryDistance ?? pitLane.entry.distanceFromStart,
    pitLane.layout?.exitDistance ?? pitLane.exit.distanceFromStart,
    distanceAmount,
  );
  const heading = pitLane.mainLane.heading;

  return {
    x: box.center.x,
    y: box.center.y,
    heading,
    normalX: pitLane.serviceNormal.x,
    normalY: pitLane.serviceNormal.y,
    curvature: 0,
    distance: distanceAlongTrack,
    signedOffset: 0,
    crossTrackError: 0,
    surface: 'pit-box',
    onTrack: true,
    inPitLane: true,
    pitLanePart: serviceArea ? 'service-box' : 'garage-box',
    pitLaneSignedOffset: 0,
    pitLaneCrossTrackError: 0,
    pitBoxId: box.id,
    pitBoxIndex: box.index,
    pitTeamId: box.teamId ?? null,
    pitLaneDistanceAlong: box.distanceAlongLane,
    pitLaneTotalLength: pitLane.mainLane.length,
    pitLaneRoadWidth: box.depth,
  };
}

export function nearestPitLaneState(track, position, progressHint = null) {
  const pitLane = track.pitLane;
  if (!pitLane?.enabled) return null;
  if (!pointInsideBounds(position, pitLane.bounds)) return null;
  const scratch = track?.queryIndex ? ensureQueryScratch(track.queryIndex) : null;

  if (!pitLane.boxBounds || pointInsideBounds(position, pitLane.boxBounds)) {
    const indexedBoxCandidates = queryPitBoxCandidates(track, position, scratch);
    const boxCandidates = indexedBoxCandidates ?? null;
    const boxState = createPitBoxState(track, position, pitLane, boxCandidates);
    if (boxState) return boxState;
  }

  const laneEntryDistance = pitLane.layout?.entryDistance ?? pitLane.entry.distanceFromStart;
  const laneExitDistance = pitLane.layout?.exitDistance ?? pitLane.exit.distanceFromStart;
  const roadCandidatesByRoute = queryPitRoadSegmentCandidatesByRoute(track, position, progressHint, scratch);
  const pitRoutes = track?.queryIndex?.pit?.routes ?? {};
  const projectionTarget = scratch ? (scratch.pitRoadProjection ??= { point: {} }) : null;
  const projectionScratch = scratch ? (scratch.pitRoadProjectionScratch ??= {}) : null;
  let bestState = null;
  bestState = pickPitState(bestState, createPitRoadState(track, position, pitLane, {
      points: pitLane.entry.roadCenterline,
      surface: 'pit-entry',
      part: 'entry',
      roadWidth: pitLane.width,
      startDistance: pitLane.entry.distanceFromStart,
      endDistance: laneEntryDistance,
      segmentCandidates: roadCandidatesByRoute?.entry ?? null,
      projectionTarget,
      projectionScratch,
      cumulativeDistances: pitRoutes.entry?.cumulativeDistances ?? null,
    }));
  bestState = pickPitState(bestState, createPitRoadState(track, position, pitLane, {
      points: pitLane.mainLane.points,
      surface: 'pit-lane',
      part: 'fast-lane',
      roadWidth: pitLane.width,
      startDistance: laneEntryDistance,
      endDistance: laneExitDistance,
      segmentCandidates: roadCandidatesByRoute?.main ?? null,
      projectionTarget,
      projectionScratch,
      cumulativeDistances: pitRoutes.main?.cumulativeDistances ?? null,
    }));
  bestState = pickPitState(bestState, createPitRoadState(track, position, pitLane, {
      points: pitLane.workingLane?.points,
      surface: 'pit-lane',
      part: 'working-lane',
      roadWidth: pitLane.workingLane?.width ?? 0,
      startDistance: laneEntryDistance,
      endDistance: laneExitDistance,
      segmentCandidates: roadCandidatesByRoute?.working ?? null,
      projectionTarget,
      projectionScratch,
      cumulativeDistances: pitRoutes.working?.cumulativeDistances ?? null,
    }));
  bestState = pickPitState(bestState, createPitRoadState(track, position, pitLane, {
      points: pitLane.exit.roadCenterline,
      surface: 'pit-exit',
      part: 'exit',
      roadWidth: pitLane.width,
      startDistance: laneExitDistance,
      endDistance: pitLane.exit.distanceFromStart,
      segmentCandidates: roadCandidatesByRoute?.exit ?? null,
      projectionTarget,
      projectionScratch,
      cumulativeDistances: pitRoutes.exit?.cumulativeDistances ?? null,
    }));

  return bestState;
}

export function resolveDirectConnectorPitLaneState(track, position, progressHint = null) {
  const pitLane = track?.pitLane;
  if (!pitLane?.enabled) return undefined;
  const inEntryConnector = pointInsideBounds(position, pitLane.connectorBounds?.entry);
  const inExitConnector = pointInsideBounds(position, pitLane.connectorBounds?.exit);
  const nearEntryProgress = Number.isFinite(progressHint) && progressHint >= pitLane.entry.trackDistance;
  const nearExitProgress = Number.isFinite(progressHint) &&
    progressHint >= 0 &&
    progressHint <= pitLane.exit.trackDistance;
  if (!inEntryConnector && !inExitConnector && !nearEntryProgress && !nearExitProgress) return undefined;

  const laneEntryDistance = pitLane.layout?.entryDistance ?? pitLane.entry.distanceFromStart;
  const laneExitDistance = pitLane.layout?.exitDistance ?? pitLane.exit.distanceFromStart;
  const scratch = track?.queryIndex ? ensureQueryScratch(track.queryIndex) : null;
  const pitRoutes = track?.queryIndex?.pit?.routes ?? {};
  const projectionTarget = scratch ? (scratch.pitRoadProjection ??= { point: {} }) : null;
  const projectionScratch = scratch ? (scratch.pitRoadProjectionScratch ??= {}) : null;
  const useEntryEndpoint = inEntryConnector || nearEntryProgress;
  const useExitEndpoint = inExitConnector || nearExitProgress;
  const useIndexedConnectorCandidates = inEntryConnector || inExitConnector;
  const roadCandidatesByRoute = (useIndexedConnectorCandidates || (!nearEntryProgress && !nearExitProgress))
    ? queryPitRoadSegmentCandidatesByRoute(track, position, null, scratch, {
      countQuery: false,
      recordPathStats: !useIndexedConnectorCandidates,
    })
    : null;
  let bestState = null;

  if (useEntryEndpoint) {
    const entrySegments = connectorRouteSegments(
      roadCandidatesByRoute,
      'entry',
      pitRoutes.entry?.startSegmentWindow ?? null,
      inEntryConnector,
    );
    bestState = pickPitState(bestState, createPitRoadState(track, position, pitLane, {
      points: pitLane.entry.roadCenterline,
      surface: 'pit-entry',
      part: 'entry',
      roadWidth: pitLane.width,
      startDistance: pitLane.entry.distanceFromStart,
      endDistance: laneEntryDistance,
      projectionTarget,
      projectionScratch,
      cumulativeDistances: pitRoutes.entry?.cumulativeDistances ?? null,
      segmentCandidates: entrySegments.segmentCandidates,
      connectorProjectionStats: true,
      connectorEndpointWindowProjection: entrySegments.endpointWindow,
    }));
  }

  if (useEntryEndpoint || useExitEndpoint) {
    const mainSegments = connectorRouteSegments(
      roadCandidatesByRoute,
      'main',
      connectorRouteSegmentWindow(pitRoutes.main, useEntryEndpoint, useExitEndpoint),
      useIndexedConnectorCandidates,
    );
    bestState = pickPitState(bestState, createPitRoadState(track, position, pitLane, {
      points: pitLane.mainLane.points,
      surface: 'pit-lane',
      part: 'fast-lane',
      roadWidth: pitLane.width,
      startDistance: laneEntryDistance,
      endDistance: laneExitDistance,
      projectionTarget,
      projectionScratch,
      cumulativeDistances: pitRoutes.main?.cumulativeDistances ?? null,
      segmentCandidates: mainSegments.segmentCandidates,
      connectorProjectionStats: true,
      connectorEndpointWindowProjection: mainSegments.endpointWindow,
    }));
    const workingSegments = connectorRouteSegments(
      roadCandidatesByRoute,
      'working',
      connectorRouteSegmentWindow(pitRoutes.working, useEntryEndpoint, useExitEndpoint),
      useIndexedConnectorCandidates,
    );
    bestState = pickPitState(bestState, createPitRoadState(track, position, pitLane, {
      points: pitLane.workingLane?.points,
      surface: 'pit-lane',
      part: 'working-lane',
      roadWidth: pitLane.workingLane?.width ?? 0,
      startDistance: laneEntryDistance,
      endDistance: laneExitDistance,
      projectionTarget,
      projectionScratch,
      cumulativeDistances: pitRoutes.working?.cumulativeDistances ?? null,
      segmentCandidates: workingSegments.segmentCandidates,
      connectorProjectionStats: true,
      connectorEndpointWindowProjection: workingSegments.endpointWindow,
    }));
  }

  if (useExitEndpoint) {
    const exitSegments = connectorRouteSegments(
      roadCandidatesByRoute,
      'exit',
      pitRoutes.exit?.endSegmentWindow ?? null,
      inExitConnector,
    );
    bestState = pickPitState(bestState, createPitRoadState(track, position, pitLane, {
      points: pitLane.exit.roadCenterline,
      surface: 'pit-exit',
      part: 'exit',
      roadWidth: pitLane.width,
      startDistance: laneExitDistance,
      endDistance: pitLane.exit.distanceFromStart,
      projectionTarget,
      projectionScratch,
      cumulativeDistances: pitRoutes.exit?.cumulativeDistances ?? null,
      segmentCandidates: exitSegments.segmentCandidates,
      connectorProjectionStats: true,
      connectorEndpointWindowProjection: exitSegments.endpointWindow,
    }));
  }

  return bestState;
}

function connectorRouteSegmentWindow(route, useStart, useEnd) {
  if (!route) return null;
  if (useStart && useEnd) return route.endpointSegmentWindow ?? null;
  if (useStart) return route.startSegmentWindow ?? null;
  if (useEnd) return route.endSegmentWindow ?? null;
  return null;
}

function connectorRouteSegments(candidatesByRoute, routeId, endpointWindow, preferIndexedCandidates) {
  if (preferIndexedCandidates && candidatesByRoute) {
    return {
      segmentCandidates: candidatesByRoute[routeId] ?? [],
      endpointWindow: false,
    };
  }
  if (Array.isArray(endpointWindow)) {
    return {
      segmentCandidates: endpointWindow,
      endpointWindow: endpointWindow.length > 0,
    };
  }
  return {
    segmentCandidates: candidatesByRoute?.[routeId] ?? null,
    endpointWindow: false,
  };
}

function pickPitState(currentBest, candidate) {
  if (!candidate) return currentBest;
  if (!currentBest) return candidate;
  return candidate.crossTrackError < currentBest.crossTrackError ? candidate : currentBest;
}

function createLegacyPitBoxCandidates(pitLane) {
  return [
    ...(pitLane.serviceAreas ?? []).flatMap((area) => [
      { type: 'service-area', target: area, polygon: area.corners },
      { type: 'service-queue', target: area, polygon: area.queueCorners },
    ]),
    ...(pitLane.boxes ?? []).map((box) => ({ type: 'garage-box', target: box, polygon: box.corners })),
  ].filter((candidate) => Array.isArray(candidate.polygon) && candidate.polygon.length >= 3);
}
