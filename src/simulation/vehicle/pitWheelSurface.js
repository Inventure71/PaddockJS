import { metersToSimUnits } from '../units.js';

const PIT_CONNECTOR_FULL_SAMPLE_WINDOW = metersToSimUnits(35);

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
  for (let index = 0; index < geometry.contactPatches.length; index += 1) {
    const range = patchPitOffsetRange(geometry.contactPatches[index], centerState);
    if (range.minimum < -halfRoadWidth - 0.001 || range.maximum > halfRoadWidth + 0.001) return false;
  }
  return true;
}

export function canSkipConnectorPitChecks(track, geometry, centerState, epsilon = 0.001) {
  const laneSide = Math.sign(track?.pitLane?.side ?? 0);
  if (
    !laneSide ||
    !geometry?.contactPatches?.length ||
    !centerState ||
    centerState.inPitLane ||
    !centerState.onTrack
  ) return false;
  for (let index = 0; index < geometry.contactPatches.length; index += 1) {
    if (!connectorPitCheckCanBeSkippedForPatch(track, geometry.contactPatches[index], centerState, epsilon)) return false;
  }
  return true;
}

export function pitPatchOffsetRange(patch, centerState) {
  return patchPitOffsetRange(patch, centerState);
}

export function pitPatchInsideRoad(patch, centerState, epsilon = 0.001) {
  const roadWidth = Number(centerState?.pitLaneRoadWidth);
  if (!centerState?.inPitLane || !Number.isFinite(roadWidth) || roadWidth <= 0) return false;
  const halfRoadWidth = roadWidth / 2;
  const range = patchPitOffsetRange(patch, centerState);
  return range.minimum >= -halfRoadWidth - epsilon && range.maximum <= halfRoadWidth + epsilon;
}

export function pitPatchOverlapsRoad(patch, centerState, epsilon = 0.001) {
  const roadWidth = Number(centerState?.pitLaneRoadWidth);
  if (!centerState?.inPitLane || !Number.isFinite(roadWidth) || roadWidth <= 0) return false;
  const halfRoadWidth = roadWidth / 2;
  const range = patchPitOffsetRange(patch, centerState);
  return range.minimum <= halfRoadWidth + epsilon && range.maximum >= -halfRoadWidth - epsilon;
}

export function writeAnalyticPitWheelState(target, patch, centerState) {
  const range = patchPitOffsetRange(patch, centerState);
  const signedOffset = centerState.mainTrackSignedOffset ?? centerState.signedOffset;
  const sampledStates = target.sampledStates ?? [];
  const sampleState = sampledStates.length === 1 ? (sampledStates[0] ?? {}) : {};
  sampledStates.length = 1;
  sampledStates[0] = sampleState;
  sampleState.signedOffset = centerState.signedOffset;
  sampleState.crossTrackError = centerState.crossTrackError;
  sampleState.surface = centerState.surface;
  sampleState.onTrack = Boolean(centerState.onTrack);
  sampleState.inPitLane = true;
  sampleState.pitLanePart = centerState.pitLanePart ?? null;
  sampleState.pitBoxId = centerState.pitBoxId ?? null;

  target.id = patch.id;
  target.x = patch.center.x;
  target.y = patch.center.y;
  target.signedOffset = signedOffset;
  target.crossTrackError = centerState.mainTrackCrossTrackError ?? centerState.crossTrackError;
  target.surface = centerState.surface;
  target.onTrack = true;
  target.inPitLane = true;
  target.pitLanePart = centerState.pitLanePart ?? null;
  target.pitBoxId = centerState.pitBoxId ?? null;
  target.minimumSignedOffset = signedOffset;
  target.maximumSignedOffset = signedOffset;
  target.pitLaneMinimumSignedOffset = range.minimum;
  target.pitLaneMaximumSignedOffset = range.maximum;
  target.fullyOutsideWhiteLine = false;
  target.outsideSide = 0;
  target.sampledStates = sampledStates;
  return target;
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

function connectorPitCheckCanBeSkippedForPatch(track, patch, centerState, epsilon) {
  const laneSide = Math.sign(track?.pitLane?.side ?? 0);
  if (!laneSide || !patch || !centerState || centerState.inPitLane || !centerState.onTrack) return false;
  const range = patchPitOffsetRange(patch, centerState);
  return laneSide > 0
    ? range.maximum <= epsilon
    : range.minimum >= -epsilon;
}

function wrappedDistanceDelta(first, second, length) {
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(length) || length <= 0) return Infinity;
  const delta = Math.abs(first - second);
  return Math.min(delta, length - delta);
}
