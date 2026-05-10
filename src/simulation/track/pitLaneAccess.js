import { clamp, wrapDistance } from '../simMath.js';
import { PIT_ACCESS_MAX_LENGTH, PIT_ACCESS_SAMPLE_STEPS, PIT_ACCESS_SEARCH_STEP, PIT_ACCESS_TRACK_OVERLAP, PIT_LANE_WIDTH } from './trackConstants.js';
import { angleBetweenVectors, headingVector, normalizeVector, sampleCubicBezier, signedLateralOffsetToPoint } from './trackMath.js';
import { offsetTrackPoint, pointAt } from './spatialQueries.js';

export function createPitAccessRoadCenterline(start, end, startForward, endForward, tangentLength) {
  return sampleCubicBezier(
    start,
    {
      x: start.x + startForward.x * tangentLength,
      y: start.y + startForward.y * tangentLength,
    },
    {
      x: end.x - endForward.x * tangentLength,
      y: end.y - endForward.y * tangentLength,
    },
    end,
    PIT_ACCESS_SAMPLE_STEPS,
  );
}

export function createLaneFacingTrackConnection(track, distanceFromStart, lanePoint) {
  const trackPoint = pointAt(track, distanceFromStart);
  const laneSide = signedLateralOffsetToPoint(trackPoint, lanePoint) >= 0 ? 1 : -1;
  const edgePoint = offsetTrackPoint(trackPoint, laneSide * (track.width / 2));
  const trackConnectPoint = offsetTrackPoint(
    trackPoint,
    laneSide * Math.max(0, track.width / 2 - PIT_ACCESS_TRACK_OVERLAP),
  );

  return {
    distanceFromStart,
    trackDistance: wrapDistance(trackPoint.distance, track.length),
    trackPoint,
    edgePoint,
    trackConnectPoint,
    laneSide,
  };
}

export function scorePitAccessConnection(track, connection, lanePoint, laneForward, direction) {
  const roadVector = direction === 'entry'
    ? normalizeVector({
      x: lanePoint.x - connection.trackConnectPoint.x,
      y: lanePoint.y - connection.trackConnectPoint.y,
    })
    : normalizeVector({
      x: connection.trackConnectPoint.x - lanePoint.x,
      y: connection.trackConnectPoint.y - lanePoint.y,
    });
  const trackForward = headingVector(connection.trackPoint.heading);
  const trackAngle = angleBetweenVectors(roadVector, trackForward);
  const laneAngle = angleBetweenVectors(roadVector, laneForward);
  const laneFacingClearance = Math.abs(signedLateralOffsetToPoint(connection.trackPoint, lanePoint)) - track.width / 2;

  return {
    ...connection,
    roadVector,
    trackAngle,
    laneAngle,
    pathLength: roadVector.length,
    score:
      trackAngle * 1100 +
      laneAngle * 900 +
      roadVector.length * 0.32 -
      Math.max(0, laneFacingClearance) * 0.18,
  };
}

export function findPitAccessConnection(track, lanePoint, laneForward, {
  direction,
  startDistance,
  endDistance,
  fallbackDistance,
}) {
  const start = Math.min(startDistance, endDistance);
  const end = Math.max(startDistance, endDistance);
  let best = null;
  let fallback = null;

  for (let distanceFromStart = start; distanceFromStart <= end; distanceFromStart += PIT_ACCESS_SEARCH_STEP) {
    const connection = scorePitAccessConnection(
      track,
      createLaneFacingTrackConnection(track, distanceFromStart, lanePoint),
      lanePoint,
      laneForward,
      direction,
    );
    fallback = !fallback || connection.score < fallback.score ? connection : fallback;
    if (connection.trackAngle > 1.15 || connection.laneAngle > 1.15) continue;
    best = !best || connection.score < best.score ? connection : best;
  }

  if (best) return best;

  return fallback ?? scorePitAccessConnection(
    track,
    createLaneFacingTrackConnection(track, fallbackDistance, lanePoint),
    lanePoint,
    laneForward,
    direction,
  );
}
