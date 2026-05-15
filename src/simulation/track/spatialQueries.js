import { clamp, normalizeAngle, wrapDistance } from '../simMath.js';
import { NEAREST_HINT_WINDOW_SAMPLES, PIT_LANE_WIDTH } from './trackConstants.js';
import { nearestPitLaneState } from './pitLaneState.js';
import { queryNearestTrackProjection } from './trackQueryIndex.js';

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

  return {
    ...best,
    signedOffset,
    crossTrackError,
    surface,
    onTrack: surface === 'track' || surface === 'kerb',
  };
}

export function nearestTrackState(track, position, progressHint = null, options = {}) {
  const allowPitOverride = options.allowPitOverride !== false;
  const best = options.indexMode === 'legacy'
    ? nearestTrackSampleLegacy(track, position, progressHint)
    : queryNearestTrackProjection(track, position, progressHint, { indexMode: options.indexMode }) ??
    nearestTrackSampleLegacy(track, position, progressHint);
  const trackState = createTrackState(track, position, best);
  if (!allowPitOverride) return trackState;
  const pitState = nearestPitLaneState(track, position);
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

function nearestTrackSampleLegacy(track, position, progressHint = null) {
  let nearest = null;

  if (Number.isFinite(progressHint)) {
    const centerIndex = sampleIndexAtDistance(track, progressHint);
    nearest = nearestSampleInRange(
      track,
      position,
      centerIndex - NEAREST_HINT_WINDOW_SAMPLES,
      centerIndex + NEAREST_HINT_WINDOW_SAMPLES,
    );
    const fallbackDistance = track.width / 2 + (track.kerbWidth ?? 0) + track.gravelWidth + track.runoffWidth + 180;
    if (!nearest.best || nearest.bestDistance > fallbackDistance * fallbackDistance) {
      nearest = null;
    }
  }

  return nearest?.best ?? nearestSampleGlobal(track, position).best;
}

export function offsetTrackPoint(point, offset) {
  return {
    x: point.x + point.normalX * offset,
    y: point.y + point.normalY * offset,
    heading: point.heading,
  };
}
