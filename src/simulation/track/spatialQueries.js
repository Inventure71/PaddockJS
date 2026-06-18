import { clamp, normalizeAngle, wrapDistance } from '../simMath.js';
import { PIT_LANE_WIDTH } from './trackConstants.js';
import { pointInsideBounds } from './trackMath.js';
import { nearestPitLaneState, resolveDirectConnectorPitLaneState } from './pitLaneState.js';
import { queryNearestTrackProjection, queryNearestTrackProjectionInto } from './trackQueryIndex.js';
import { recordStat } from './trackQueryStats.js';

export function pointAt(track, distanceAlong) {
  return pointAtInto(track, distanceAlong, {});
}

export function pointAtInto(track, distanceAlong, target) {
  const wrapped = wrapDistance(distanceAlong, track.length);
  const low = sampleIndexAtDistanceUnwrapped(track, wrapped);

  const next = track.samples[low] ?? track.samples[0];
  const previous = track.samples[Math.max(0, low - 1)] ?? next;
  const span = Math.max(1, next.distance - previous.distance);
  const amount = clamp((wrapped - previous.distance) / span, 0, 1);

  target.x = previous.x + (next.x - previous.x) * amount;
  target.y = previous.y + (next.y - previous.y) * amount;
  target.heading = previous.heading + normalizeAngle(next.heading - previous.heading) * amount;
  target.normalX = previous.normalX + (next.normalX - previous.normalX) * amount;
  target.normalY = previous.normalY + (next.normalY - previous.normalY) * amount;
  target.curvature = previous.curvature + (next.curvature - previous.curvature) * amount;
  target.distance = wrapped;
  return target;
}

export function sampleHeadingCurvatureAtInto(track, distanceAlong, target) {
  const wrapped = wrapDistance(distanceAlong, track.length);
  const low = sampleIndexAtDistanceUnwrapped(track, wrapped);

  const next = track.samples[low] ?? track.samples[0];
  const previous = track.samples[Math.max(0, low - 1)] ?? next;
  const span = Math.max(1, next.distance - previous.distance);
  const amount = clamp((wrapped - previous.distance) / span, 0, 1);

  target.heading = previous.heading + normalizeAngle(next.heading - previous.heading) * amount;
  target.curvature = previous.curvature + (next.curvature - previous.curvature) * amount;
  return target;
}

export function sampleHeadingAt(track, distanceAlong) {
  const wrapped = wrapDistance(distanceAlong, track.length);
  const low = sampleIndexAtDistanceUnwrapped(track, wrapped);

  const next = track.samples[low] ?? track.samples[0];
  const previous = track.samples[Math.max(0, low - 1)] ?? next;
  const span = Math.max(1, next.distance - previous.distance);
  const amount = clamp((wrapped - previous.distance) / span, 0, 1);

  return previous.heading + normalizeAngle(next.heading - previous.heading) * amount;
}

export function sampleIndexAtDistance(track, distanceAlong) {
  return binarySampleIndexAtDistance(track, wrapDistance(distanceAlong, track.length));
}

function binarySampleIndexAtDistance(track, wrapped) {
  let low = 0;
  let high = track.samples.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (track.samples[mid].distance < wrapped) low = mid + 1;
    else high = mid;
  }

  return low;
}

// Uniform-bin index over sample distances: table[bin] holds the smallest
// sample index whose distance reaches the bin start, so a lookup plus a short
// forward walk returns exactly what the binary search would, in O(1). Built
// eagerly when the track query index is attached; lookups on sample arrays
// without a prepared table fall back to the binary search.
const SAMPLE_INDEX_LUTS = new WeakMap();

export function prepareSampleIndexLut(track) {
  const samples = track?.samples;
  if (!Array.isArray(samples) || samples.length < 2 || !Number.isFinite(track.length) || track.length <= 0) return;
  if (SAMPLE_INDEX_LUTS.has(samples)) return;
  const lastIndex = samples.length - 1;
  const bins = Math.max(1, lastIndex * 2);
  const table = new Int32Array(bins);
  const binSize = track.length / bins;
  let index = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const start = bin * binSize;
    while (index < lastIndex && samples[index].distance < start) index += 1;
    table[bin] = index;
  }
  SAMPLE_INDEX_LUTS.set(samples, { bins, binSize, table });
}

function sampleIndexAtDistanceUnwrapped(track, wrapped) {
  const samples = track.samples;
  const lut = Number.isFinite(wrapped) ? SAMPLE_INDEX_LUTS.get(samples) : null;
  if (!lut) return binarySampleIndexAtDistance(track, wrapped);
  const lastIndex = samples.length - 1;
  let bin = Math.floor(wrapped / lut.binSize);
  if (bin < 0) bin = 0;
  else if (bin >= lut.bins) bin = lut.bins - 1;
  let index = lut.table[bin];
  while (index < lastIndex && samples[index].distance < wrapped) index += 1;
  return index;
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
