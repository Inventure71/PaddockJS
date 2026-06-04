import { clamp, normalizeAngle, wrapDistance } from '../simMath.js';
import { PIT_LANE_WIDTH } from './trackConstants.js';
import { pointInsideBounds } from './trackMath.js';
import { nearestPitLaneState, resolveDirectConnectorPitLaneState } from './pitLaneState.js';
import { queryNearestTrackProjection, queryNearestTrackProjectionInto } from './trackQueryIndex.js';
import { recordStat } from './trackQueryStats.js';

export function pointAt(track, distanceAlong) {
  const wrapped = wrapDistance(distanceAlong, track.length);
  const low = sampleIndexAtDistance(track, wrapped);

  const next = track.samples[low] ?? track.samples[0];
  const previous = track.samples[Math.max(0, low - 1)] ?? next;
  const span = Math.max(1, next.distance - previous.distance);
  const amount = clamp((wrapped - previous.distance) / span, 0, 1);

  return {
    x: previous.x + (next.x - previous.x) * amount,
    y: previous.y + (next.y - previous.y) * amount,
    heading: previous.heading + normalizeAngle(next.heading - previous.heading) * amount,
    normalX: previous.normalX + (next.normalX - previous.normalX) * amount,
    normalY: previous.normalY + (next.normalY - previous.normalY) * amount,
    curvature: previous.curvature + (next.curvature - previous.curvature) * amount,
    distance: wrapped,
  };
}

export function sampleIndexAtDistance(track, distanceAlong) {
  const wrapped = wrapDistance(distanceAlong, track.length);
  let low = 0;
  let high = track.samples.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (track.samples[mid].distance < wrapped) low = mid + 1;
    else high = mid;
  }

  return low;
}

export function nearestSampleInRange(track, position, startIndex, endIndex) {
  const sampleCount = track.samples.length - 1;
  let best = null;
  let bestDistance = Infinity;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const wrappedIndex = ((index % sampleCount) + sampleCount) % sampleCount;
    const sample = track.samples[wrappedIndex];
    const dx = position.x - sample.x;
    const dy = position.y - sample.y;
    const squared = dx * dx + dy * dy;
    if (squared < bestDistance) {
      bestDistance = squared;
      best = sample;
    }
  }

  return { best, bestDistance };
}

export function nearestSampleGlobal(track, position) {
  return nearestSampleInRange(track, position, 0, track.samples.length - 2);
}

export function createTrackState(track, position, best) {
  return writeTrackState({}, track, position, best);
}

export function writeTrackState(target, track, position, best) {
  const dx = position.x - best.x;
  const dy = position.y - best.y;
  const signedOffset = dx * best.normalX + dy * best.normalY;
  const crossTrackError = Math.abs(signedOffset);
  const trackEdge = track.width / 2;
  const kerbEdge = trackEdge + (track.kerbWidth ?? 0);
  const gravelEdge = kerbEdge + track.gravelWidth;
  const runoffEdge = gravelEdge + track.runoffWidth;
  const surface = crossTrackError <= trackEdge
    ? 'track'
    : crossTrackError <= kerbEdge
      ? 'kerb'
      : crossTrackError <= gravelEdge
        ? 'gravel'
        : crossTrackError <= runoffEdge
          ? 'grass'
          : 'barrier';

  target.segmentId = best.segmentId;
  target.x = best.x;
  target.y = best.y;
  target.distance = best.distance;
  target.heading = best.heading;
  target.normalX = best.normalX;
  target.normalY = best.normalY;
  target.curvature = best.curvature;
  target.signedOffset = signedOffset;
  target.crossTrackError = crossTrackError;
  target.surface = surface;
  target.onTrack = surface === 'track' || surface === 'kerb';
  target.distanceSquared = best.distanceSquared;
  target.inPitLane = undefined;
  target.pitLanePart = undefined;
  target.pitBoxId = undefined;
  target.mainTrackSignedOffset = undefined;
  target.mainTrackCrossTrackError = undefined;
  return target;
}

export function nearestTrackState(track, position, progressHint = null, options = {}) {
  const allowPitOverride = options.allowPitOverride !== false;
  const scratch = track?.queryIndex?.queryScratch ?? null;
  const best = queryNearestTrackProjectionInto(
    track,
    position,
    progressHint,
    scratch ? (scratch.nearestProjection ??= {}) : null,
  );
  if (!best) {
    throw new Error('nearestTrackState requires a finite position and an indexed track model. Build tracks with buildTrackModel() or createRaceSimulation().');
  }
  const trackState = createTrackState(track, position, best);
  if (!allowPitOverride) return trackState;
  const pitState = queryPitOverrideState(track, position, progressHint, trackState);
  if (!pitState) return trackState;
  return resolveTrackStatePitOverride(track, trackState, pitState);
}

export function resolveTrackStatePitOverride(track, trackState, pitState) {
  if (!pitState) return trackState;

  const mainRoadEdge = track.width / 2 + (track.kerbWidth ?? 0);
  if (trackState.crossTrackError <= mainRoadEdge && pitState.surface !== 'pit-box') return trackState;

  const mergeBuffer = PIT_LANE_WIDTH * 0.16;
  const isMainTrackMerge =
    trackState.surface === 'track' &&
    (
      (pitState.surface === 'pit-entry' && pitState.pitLaneDistanceAlong <= mergeBuffer) ||
      (pitState.surface === 'pit-exit' && (pitState.pitLaneTotalLength - pitState.pitLaneDistanceAlong) <= mergeBuffer)
    );

  if (isMainTrackMerge) return trackState;

  return {
    ...pitState,
    mainTrackSignedOffset: trackState.signedOffset,
    mainTrackCrossTrackError: trackState.crossTrackError,
    signedOffset: trackState.signedOffset,
    crossTrackError: trackState.crossTrackError,
  };
}

function queryPitOverrideState(track, position, progressHint, trackState) {
  const pitLane = track?.pitLane;
  if (!pitLane?.enabled) return null;
  if (!pointInsideBounds(position, pitLane.bounds)) return null;
  if (pitLane.boxBounds && pointInsideBounds(position, pitLane.boxBounds)) {
    return nearestPitLaneState(track, position, progressHint);
  }

  const mainRoadEdge = track.width / 2 + (track.kerbWidth ?? 0);
  if (trackState.crossTrackError <= mainRoadEdge) {
    recordStat(track?.queryIndex, 'pitPaths', 'main-road-skip');
    return null;
  }
  if ((trackState.signedOffset ?? 0) * pitLane.side > 0) {
    const directConnectorState = resolveDirectConnectorPitLaneState(track, position, progressHint);
    if (directConnectorState !== undefined) {
      if (directConnectorState) {
        recordStat(track?.queryIndex, 'pitPaths', 'connector-direct-state');
        return directConnectorState;
      }
      recordStat(track?.queryIndex, 'pitPaths', 'connector-direct-skip');
      return null;
    }
  }
  return nearestPitLaneState(track, position, progressHint);
}

export function offsetTrackPoint(point, offset) {
  return {
    x: point.x + point.normalX * offset,
    y: point.y + point.normalY * offset,
    heading: point.heading,
  };
}
