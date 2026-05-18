import { metersToSimUnits } from '../units.js';

const PIT_CONNECTOR_FULL_SAMPLE_WINDOW = metersToSimUnits(35);

export function patchSamples(patch) {
  return [patch.center, ...patch.corners];
}

export function isNearPitConnector(track, centerState) {
  const pitLane = track.pitLane;
  if (!pitLane?.enabled) return false;
  const distance = centerState.distance;
  const entryDistance = pitLane.entry?.trackDistance ?? pitLane.entry?.distanceFromStart;
  const exitDistance = pitLane.exit?.trackDistance ?? pitLane.exit?.distanceFromStart;
  return wrappedDistanceDelta(distance, entryDistance, track.length) <= PIT_CONNECTOR_FULL_SAMPLE_WINDOW ||
    wrappedDistanceDelta(distance, exitDistance, track.length) <= PIT_CONNECTOR_FULL_SAMPLE_WINDOW;
}

export function canUseAnalyticPitWheels(geometry, centerState) {
  const roadWidth = Number(centerState?.pitLaneRoadWidth);
  if (!centerState?.inPitLane || !Number.isFinite(roadWidth) || roadWidth <= 0) return false;
  const halfRoadWidth = roadWidth / 2;
  return geometry.contactPatches.every((patch) => {
    const range = patchPitOffsetRange(patch, centerState);
    return range.minimum >= -halfRoadWidth - 0.001 && range.maximum <= halfRoadWidth + 0.001;
  });
}

export function analyticPitWheelState(patch, centerState) {
  const range = patchPitOffsetRange(patch, centerState);
  return {
    id: patch.id,
    x: patch.center.x,
    y: patch.center.y,
    signedOffset: centerState.mainTrackSignedOffset ?? centerState.signedOffset,
    crossTrackError: centerState.mainTrackCrossTrackError ?? centerState.crossTrackError,
    surface: centerState.surface,
    onTrack: true,
    inPitLane: true,
    pitLanePart: centerState.pitLanePart ?? null,
    pitBoxId: centerState.pitBoxId ?? null,
    minimumSignedOffset: centerState.mainTrackSignedOffset ?? centerState.signedOffset,
    maximumSignedOffset: centerState.mainTrackSignedOffset ?? centerState.signedOffset,
    pitLaneMinimumSignedOffset: range.minimum,
    pitLaneMaximumSignedOffset: range.maximum,
    fullyOutsideWhiteLine: false,
    outsideSide: 0,
    sampledStates: [centerState],
  };
}

function patchPitOffsetRange(patch, centerState) {
  const wheelCenterOffset =
    (patch.center.x - centerState.x) * centerState.normalX +
    (patch.center.y - centerState.y) * centerState.normalY;
  const projectedHalfWidth =
    Math.abs(patch.forward.x * centerState.normalX + patch.forward.y * centerState.normalY) * patch.halfLength +
    Math.abs(patch.right.x * centerState.normalX + patch.right.y * centerState.normalY) * patch.halfWidth;
  return {
    minimum: wheelCenterOffset - projectedHalfWidth,
    maximum: wheelCenterOffset + projectedHalfWidth,
  };
}

function wrappedDistanceDelta(first, second, length) {
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(length) || length <= 0) return Infinity;
  const delta = Math.abs(first - second);
  return Math.min(delta, length - delta);
}
