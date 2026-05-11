import { clamp, wrapDistance } from '../simMath.js';
import { PIT_LANE_WIDTH } from './trackConstants.js';
import { nearestPointOnPolyline, pointInsideBounds, pointIsInsidePolygon } from './trackMath.js';
import { queryPitBoxCandidates, queryPitRoadSegmentCandidatesByRoute } from './trackQueryIndex.js';

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
}) {
  if (Array.isArray(segmentCandidates) && segmentCandidates.length === 0) return null;
  const projected = nearestPointOnPolyline(points, position, segmentCandidates);
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

export function nearestPitLaneState(track, position) {
  const pitLane = track.pitLane;
  if (!pitLane?.enabled) return null;
  if (!pointInsideBounds(position, pitLane.bounds)) return null;

  const indexedBoxCandidates = queryPitBoxCandidates(track, position);
  const boxCandidates = indexedBoxCandidates ?? null;
  const boxState = createPitBoxState(track, position, pitLane, boxCandidates);
  if (boxState) return boxState;

  const laneEntryDistance = pitLane.layout?.entryDistance ?? pitLane.entry.distanceFromStart;
  const laneExitDistance = pitLane.layout?.exitDistance ?? pitLane.exit.distanceFromStart;
  const roadCandidatesByRoute = queryPitRoadSegmentCandidatesByRoute(track, position);
  const candidates = [
    createPitRoadState(track, position, pitLane, {
      points: pitLane.entry.roadCenterline,
      surface: 'pit-entry',
      part: 'entry',
      roadWidth: pitLane.width,
      startDistance: pitLane.entry.distanceFromStart,
      endDistance: laneEntryDistance,
      segmentCandidates: roadCandidatesByRoute?.entry ?? null,
    }),
    createPitRoadState(track, position, pitLane, {
      points: pitLane.mainLane.points,
      surface: 'pit-lane',
      part: 'fast-lane',
      roadWidth: pitLane.width,
      startDistance: laneEntryDistance,
      endDistance: laneExitDistance,
      segmentCandidates: roadCandidatesByRoute?.main ?? null,
    }),
    createPitRoadState(track, position, pitLane, {
      points: pitLane.workingLane?.points,
      surface: 'pit-lane',
      part: 'working-lane',
      roadWidth: pitLane.workingLane?.width ?? 0,
      startDistance: laneEntryDistance,
      endDistance: laneExitDistance,
      segmentCandidates: roadCandidatesByRoute?.working ?? null,
    }),
    createPitRoadState(track, position, pitLane, {
      points: pitLane.exit.roadCenterline,
      surface: 'pit-exit',
      part: 'exit',
      roadWidth: pitLane.width,
      startDistance: laneExitDistance,
      endDistance: pitLane.exit.distanceFromStart,
      segmentCandidates: roadCandidatesByRoute?.exit ?? null,
    }),
  ].filter(Boolean);

  return candidates.sort((left, right) => left.crossTrackError - right.crossTrackError)[0] ?? null;
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
