import { nearestTrackState, offsetTrackPoint } from '../../simulation/track/trackModel.js';
import { queryNearbyTrackProjections } from '../../simulation/track/trackQueryIndex.js';
import { metersToSimUnits } from '../../simulation/units.js';
import { NON_LOCAL_SAMPLE_STEP, OFFSET_GAP_SAMPLE_COUNT, OFFSET_SEGMENT_SAMPLE_COUNT, SEGMENTED_STROKE_STEP } from './trackRenderConstants.js';
import { arcDistance, interpolatedSegmentPoint, pointDistance } from './trackRenderGeometry.js';
import { finishTrackRenderSteps } from './trackRenderSteps.js';

export function offsetPointIsLocal(track, source, point, offset) {
  const state = nearestTrackState(track, point);
  const localTolerance = Math.max(metersToSimUnits(105), Math.abs(offset) * 2.1);
  const minimumEdgeDistance = Math.min(track.width / 2 - metersToSimUnits(4), Math.abs(offset) * 0.72);

  return (
    arcDistance(track, state.distance, source.distance) <= localTolerance &&
    state.crossTrackError >= minimumEdgeDistance
  );
}

export function offsetPointOverlapsNonLocalRoad(track, source, point, offset) {
  const localTolerance = Math.max(metersToSimUnits(105), Math.abs(offset) * 2.1);
  const roadBand = track.width / 2 + (track.kerbWidth ?? 0) + metersToSimUnits(4);
  const roadBandSquared = (roadBand + metersToSimUnits(20)) ** 2;
  const indexedCandidates = queryNearbyTrackProjections(track, point);

  if (indexedCandidates) {
    return indexedCandidates.some((state) => (
      arcDistance(track, state.distance, source.distance) > localTolerance &&
      state.distanceSquared <= roadBandSquared &&
      state.crossTrackError <= roadBand
    ));
  }

  for (let index = 0; index < track.samples.length - 1; index += NON_LOCAL_SAMPLE_STEP) {
    const sample = track.samples[index];
    if (arcDistance(track, sample.distance, source.distance) <= localTolerance) continue;

    const dx = point.x - sample.x;
    const dy = point.y - sample.y;
    if (dx * dx + dy * dy > roadBandSquared) continue;

    const signedOffset = dx * sample.normalX + dy * sample.normalY;
    if (Math.abs(signedOffset) <= roadBand) return true;
  }

  return false;
}

export function offsetSegmentIsSafe(track, current, next, start, end, offset) {
  const centerDistance = Math.hypot(next.x - current.x, next.y - current.y);
  const edgeDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const maxEdgeDistance = Math.max(centerDistance * 2.6, track.width * 0.58);
  if (edgeDistance > maxEdgeDistance || Math.abs(offset) > track.width + track.gravelWidth + track.runoffWidth) {
    return false;
  }

  const forwardDistance = ((next.distance - current.distance + track.length) % track.length) || centerDistance;

  for (let sample = 0; sample <= OFFSET_SEGMENT_SAMPLE_COUNT; sample += 1) {
    const amount = sample / OFFSET_SEGMENT_SAMPLE_COUNT;
    const source = {
      distance: (current.distance + forwardDistance * amount) % track.length,
    };
    const point = interpolatedSegmentPoint(start, end, amount);
    if (!offsetPointIsLocal(track, source, point, offset)) return false;
    if (offsetPointOverlapsNonLocalRoad(track, source, point, offset)) return false;
  }

  return true;
}

export function offsetGapBridgeIsSafe(track, start, end, width) {
  const bridgeDistance = pointDistance(start, end);
  const maximumBridgeDistance = Math.max(track.width * 0.08, width * 3.4);
  if (bridgeDistance > maximumBridgeDistance) return false;

  const minimumEdgeDistance = track.width / 2 - Math.max(width * 2.5, metersToSimUnits(4.75));
  for (let sample = 1; sample < OFFSET_GAP_SAMPLE_COUNT; sample += 1) {
    const amount = sample / OFFSET_GAP_SAMPLE_COUNT;
    const point = interpolatedSegmentPoint(start, end, amount);
    const state = nearestTrackState(track, point);
    if (state.crossTrackError < minimumEdgeDistance) return false;
  }

  return true;
}

export function getOffsetStrokeSegments(track, {
  side,
  offset,
  step = SEGMENTED_STROKE_STEP,
}) {
  return finishTrackRenderSteps(getOffsetStrokeSegmentSteps(track, { side, offset, step }));
}

export function* getOffsetStrokeSegmentSteps(track, {
  side,
  offset,
  step = SEGMENTED_STROKE_STEP,
}) {
  const samples = track.samples.slice(0, -1);
  const signedOffset = side * offset;
  const segments = [];

  for (let index = 0; index < samples.length; index += 1) {
    if (index % step !== 0) continue;
    yield;

    const current = samples[index];
    const next = samples[(index + step) % samples.length];
    const start = offsetTrackPoint(current, signedOffset);
    const end = offsetTrackPoint(next, signedOffset);

    segments.push({
      current,
      next,
      start,
      end,
      safe: offsetSegmentIsSafe(track, current, next, start, end, signedOffset),
    });
  }
  return segments;
}

export function getOffsetGapBridges(track, segments, width) {
  return finishTrackRenderSteps(getOffsetGapBridgeSteps(track, segments, width));
}

export function* getOffsetGapBridgeSteps(track, segments, width) {
  if (segments.length < 2) return [];
  const bridges = [];

  for (let index = 0; index < segments.length; index += 1) {
    yield;
    const segment = segments[index];
    if (!segment.safe) continue;

    const previousIndex = (index - 1 + segments.length) % segments.length;
    if (segments[previousIndex].safe) continue;

    let previousSafe = null;
    for (let lookup = 2; lookup <= segments.length; lookup += 1) {
      yield;
      const candidate = segments[(index - lookup + segments.length) % segments.length];
      if (!candidate.safe) continue;
      previousSafe = candidate;
      break;
    }

    if (!previousSafe || previousSafe === segment) continue;
    if (!offsetGapBridgeIsSafe(track, previousSafe.end, segment.start, width)) continue;

    bridges.push({
      start: previousSafe.end,
      end: segment.start,
    });
  }
  return bridges;
}
