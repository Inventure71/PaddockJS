import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import { nearestTrackState } from '../../simulation/track/trackModel.js';
import { nearestPitLaneState } from '../../simulation/track/pitLaneState.js';
import { resolveTrackStatePitOverride, sampleIndexAtDistance, writeTrackState } from '../../simulation/track/spatialQueries.js';
import { pointInsideBounds } from '../../simulation/track/trackMath.js';
import { querySegmentNeighborhoodProjection, querySegmentNeighborhoodProjections } from '../../simulation/track/trackQueryIndex.js';
import {
  ANALYTIC_TRACK_RAY_MAX_CURVATURE,
  DRIVER_RAY_REFINE_STEPS,
  TRACK_RAY_REFINE_STEPS,
  TRACK_RAY_STEP_METERS,
} from './rayDefaults.js';
import { findIndexedRayBoundaryDistances } from './indexedRayBands.js';
import { createRayChannelFlags, isLegalRaySurface, writeRayChannelFlags } from './rayChannels.js';
import { canUseIndexedRecoveryRayApproximation } from './rayGuards.js';
import { isNearPitConnector } from './pitConnectorProximity.js';

const BOUNDARY_VALIDATION_EPSILON_METERS = 0.25;
const LOCAL_SEGMENT_RECOVERY_BATCH_SIZE = 16;

export function traceIndexedRayBands({
  track,
  origin,
  vector,
  lengthMeters,
  originState,
  channels = [],
  precision = 'driver',
  sharedRayQuery = null,
  stats = null,
  validateBoundaries = true,
  allowPitOverride = false,
  mainTrackOnly = false,
} = {}) {
  const channelSet = rayChannelFlagsFor(channels, sharedRayQuery, stats);
  const result = prepareTraceResult(sharedRayQuery, lengthMeters);
  const fallbackReason = directTraceFallbackReason({ track, origin, vector, lengthMeters, originState, precision, mainTrackOnly });
  if (fallbackReason) {
    const sampled = trySampledRecovery({
      track,
      origin,
      vector,
      lengthMeters,
      originState,
      channels: channelSet,
      allowPitOverride,
      sharedRayQuery,
      reason: fallbackReason,
      mainTrackOnly,
      precision,
    });
    if (sampled) return sampled;
    return writeTraceMeta(result, false, null, null, fallbackReason);
  }

  if (mainTrackOnly) {
    const directLocalBand = tryDirectLocalBandRecovery({
      track,
      vector,
      lengthMeters,
      originState,
      channels: channelSet,
      sharedRayQuery,
      reason: 'main-track-only',
    });
    if (directLocalBand) return directLocalBand;
  }

  const trackHalfWidth = track.width / 2;
  const boundaries = findIndexedSurfaceBoundaries(
    track,
    origin,
    vector,
    lengthMeters,
    channelSet,
    originState,
    sharedRayQuery,
  );
  if (!boundaries.available) {
    return writeTraceMeta(result, false, null, null, 'boundary-index-unavailable');
  }
  const boundaryStateCache = prepareBoundaryStateCache(sharedRayQuery);
  const boundaryFallbackReason = directBoundaryFallbackReason({
    track,
    origin,
    originState,
    vector,
    lengthMeters,
    channels: channelSet,
    boundaries,
    validateBoundaries,
    boundaryStateCache,
    allowPitOverride,
  });
  if (boundaryFallbackReason) {
    const sampled = trySampledRecovery({
      track,
      origin,
      vector,
      lengthMeters,
      originState,
      channels: channelSet,
      allowPitOverride,
      sharedRayQuery,
      reason: boundaryFallbackReason,
      mainTrackOnly,
      precision,
    });
    if (sampled) return sampled;
    return writeTraceMeta(result, false, null, null, boundaryFallbackReason);
  }

  if (channelSet.hasRoadEdge) {
    directRoadEdgeHit(result.roadEdge, originState, boundaries.trackEdgeDistance, lengthMeters, trackHalfWidth);
  }
  if (channelSet.hasKerb) {
    directKerbHit(result.kerb, originState, boundaries, lengthMeters);
  }
  if (channelSet.hasIllegalSurface) {
    directIllegalSurfaceHit(result.illegalSurface, track, origin, originState, vector, boundaries, lengthMeters, boundaryStateCache);
  }
  return writeTraceMeta(result, true, 'direct', null, null);
}

function prepareTraceResult(sharedRayQuery, lengthMeters) {
  const result = sharedRayQuery
    ? (sharedRayQuery.traceResult ?? {})
    : {};
  if (sharedRayQuery) sharedRayQuery.traceResult = result;
  result.roadEdge = writeTrackMiss(result.roadEdge ?? {}, lengthMeters);
  result.kerb = writeSurfaceMiss(result.kerb ?? {}, lengthMeters);
  result.illegalSurface = writeSurfaceMiss(result.illegalSurface ?? {}, lengthMeters);
  return writeTraceMeta(result, false, null, null, null);
}

function writeTraceMeta(result, available, path, sampledReason, fallbackReason) {
  result.available = available;
  result.path = path;
  result.sampledReason = sampledReason;
  result.fallbackReason = fallbackReason;
  return result;
}

function rayChannelFlagsFor(channels, sharedRayQuery, stats) {
  const target = sharedRayQuery
    ? (sharedRayQuery.channelFlags ?? createRayChannelFlags())
    : createRayChannelFlags();
  const flags = writeRayChannelFlags(target, channels);
  if (sharedRayQuery) sharedRayQuery.channelFlags = flags;
  if (stats && !Number.isFinite(stats.channelSetAllocations)) stats.channelSetAllocations = 0;
  return flags;
}

function findIndexedSurfaceBoundaries(track, origin, vector, lengthMeters, channels, originState, cache = null) {
  if (cache?.surfaceBoundaries) return cache.surfaceBoundaries;
  const trackHalfWidth = track.width / 2;
  const kerbOuter = trackHalfWidth + (track.kerbWidth ?? 0);
  const runoffOuter = kerbOuter + (track.gravelWidth ?? 0) + (track.runoffWidth ?? 0);
  const scratch = prepareSurfaceBoundaryScratch(cache);
  const offsets = scratch?.offsets ?? [];
  offsets.length = 0;
  let trackPositive = -1;
  let trackNegative = -1;
  let kerbPositive = -1;
  let kerbNegative = -1;
  let runoffPositive = -1;
  let runoffNegative = -1;

  if (channels.hasRoadEdge || channels.hasKerb) {
    trackPositive = offsets.push(trackHalfWidth) - 1;
    trackNegative = offsets.push(-trackHalfWidth) - 1;
  }
  if (
    channels.hasKerb ||
    (channels.hasIllegalSurface && isLegalRaySurface(originState.surface))
  ) {
    kerbPositive = offsets.push(kerbOuter) - 1;
    kerbNegative = offsets.push(-kerbOuter) - 1;
  }
  if (channels.hasIllegalSurface && originState.surface === 'barrier') {
    runoffPositive = offsets.push(runoffOuter) - 1;
    runoffNegative = offsets.push(-runoffOuter) - 1;
  }

  const boundaries = findIndexedRayBoundaryDistances(
    track,
    origin,
    vector,
    lengthMeters,
    offsets,
    scratch?.boundaryDistances,
  );
  const result = scratch?.result ?? {};
  result.available = boundaries.available;
  result.trackEdgeDistance = nearestBoundaryDistance(
    boundaries.distances[trackPositive],
    boundaries.segmentIds[trackPositive],
    boundaries.distances[trackNegative],
    boundaries.segmentIds[trackNegative],
  );
  result.trackEdgeSegmentId = nearestBoundarySegmentId(
    boundaries.distances[trackPositive],
    boundaries.segmentIds[trackPositive],
    boundaries.distances[trackNegative],
    boundaries.segmentIds[trackNegative],
  );
  result.kerbOuterDistance = nearestBoundaryDistance(
    boundaries.distances[kerbPositive],
    boundaries.segmentIds[kerbPositive],
    boundaries.distances[kerbNegative],
    boundaries.segmentIds[kerbNegative],
  );
  result.kerbOuterSegmentId = nearestBoundarySegmentId(
    boundaries.distances[kerbPositive],
    boundaries.segmentIds[kerbPositive],
    boundaries.distances[kerbNegative],
    boundaries.segmentIds[kerbNegative],
  );
  result.runoffOuterDistance = nearestBoundaryDistance(
    boundaries.distances[runoffPositive],
    boundaries.segmentIds[runoffPositive],
    boundaries.distances[runoffNegative],
    boundaries.segmentIds[runoffNegative],
  );
  result.runoffOuterSegmentId = nearestBoundarySegmentId(
    boundaries.distances[runoffPositive],
    boundaries.segmentIds[runoffPositive],
    boundaries.distances[runoffNegative],
    boundaries.segmentIds[runoffNegative],
  );
  if (cache) cache.surfaceBoundaries = result;
  return result;
}

function prepareSurfaceBoundaryScratch(cache) {
  if (!cache) return null;
  const scratch = cache.surfaceBoundaryScratch ?? {
    offsets: [],
    boundaryDistances: {},
    result: {},
  };
  cache.surfaceBoundaryScratch = scratch;
  return scratch;
}

function directBoundaryFallbackReason({
  track,
  origin,
  originState,
  vector,
  lengthMeters,
  channels,
  boundaries,
  validateBoundaries,
  boundaryStateCache,
  allowPitOverride,
}) {
  const trackHalfWidth = track.width / 2;
  const kerbOuter = trackHalfWidth + (track.kerbWidth ?? 0);
  const trustTrackOriginIllegalSurfaceBoundary = originState.surface === 'track';
  const barrierOriginCanStayDirect = originState.surface === 'barrier';
  if (
    validateBoundaries &&
    channels.hasRoadEdge &&
    Number.isFinite(boundaries.trackEdgeDistance) &&
    !validatedTrackBoundaryHit(track, origin, originState, vector, boundaries.trackEdgeDistance, boundaries.trackEdgeSegmentId, lengthMeters, boundaryStateCache, allowPitOverride)
  ) {
    return 'road-edge-validation';
  }
  const kerbBoundaryDistance = minFinite(boundaries.trackEdgeDistance, boundaries.kerbOuterDistance);
  const kerbBoundarySegmentId = nearestBoundarySegmentId(
    boundaries.trackEdgeDistance,
    boundaries.trackEdgeSegmentId,
    boundaries.kerbOuterDistance,
    boundaries.kerbOuterSegmentId,
  );
  if (
    validateBoundaries &&
    channels.hasKerb &&
    Number.isFinite(kerbBoundaryDistance) &&
    originState.surface !== 'kerb' &&
    !validatedSurfaceBoundaryHit(track, origin, originState, vector, kerbBoundaryDistance, kerbBoundarySegmentId, lengthMeters, 'kerb', boundaryStateCache, allowPitOverride)
  ) {
    return 'kerb-validation';
  }
  if (
    validateBoundaries &&
    channels.hasIllegalSurface &&
    !trustTrackOriginIllegalSurfaceBoundary &&
    isLegalRaySurface(originState.surface) &&
    Number.isFinite(boundaries.kerbOuterDistance) &&
    !validatedSurfaceBoundaryHit(track, origin, originState, vector, boundaries.kerbOuterDistance, boundaries.kerbOuterSegmentId, lengthMeters, 'illegalSurface', boundaryStateCache, allowPitOverride)
  ) {
    return 'illegal-surface-validation';
  }
  if (
    validateBoundaries &&
    channels.hasIllegalSurface &&
    !trustTrackOriginIllegalSurfaceBoundary &&
    originState.surface === 'barrier' &&
    Number.isFinite(boundaries.runoffOuterDistance) &&
    !validatedSurfaceBoundaryHit(track, origin, originState, vector, boundaries.runoffOuterDistance, boundaries.runoffOuterSegmentId, lengthMeters, 'illegalSurface', boundaryStateCache, allowPitOverride)
  ) {
    return 'illegal-surface-validation';
  }
  if (
    channels.hasRoadEdge &&
    boundaries.trackEdgeDistance == null &&
    Math.abs(originState.signedOffset) > trackHalfWidth &&
    !barrierOriginCanStayDirect
  ) {
    return 'road-edge-recovery';
  }
  if (
    channels.hasKerb &&
    boundaries.trackEdgeDistance == null &&
    boundaries.kerbOuterDistance == null &&
    Math.abs(originState.signedOffset) > kerbOuter &&
    !barrierOriginCanStayDirect
  ) {
    return 'kerb-recovery';
  }
  return null;
}

function validatedTrackBoundaryHit(track, origin, originState, vector, distance, segmentId, lengthMeters, boundaryStateCache, allowPitOverride) {
  if (originState.surface === 'track') {
    const after = stateAtBoundary(track, origin, originState, vector, distance, segmentId, lengthMeters, 1, boundaryStateCache, allowPitOverride);
    return Math.abs(after.crossTrackError ?? Infinity) > track.width / 2;
  }
  const originInside = Math.abs(originState.signedOffset ?? 0) <= track.width / 2;
  const before = stateAtBoundary(track, origin, originState, vector, distance, segmentId, lengthMeters, -1, boundaryStateCache, allowPitOverride);
  const after = stateAtBoundary(track, origin, originState, vector, distance, segmentId, lengthMeters, 1, boundaryStateCache, allowPitOverride);
  const beforeInside = Math.abs(before.crossTrackError ?? Infinity) <= track.width / 2;
  const afterInside = Math.abs(after.crossTrackError ?? Infinity) <= track.width / 2;
  if (beforeInside === afterInside) return false;
  return originInside ? !afterInside : afterInside;
}

function validatedSurfaceBoundaryHit(track, origin, originState, vector, distance, segmentId, lengthMeters, channel, boundaryStateCache, allowPitOverride) {
  if (originState.surface === 'track') {
    const after = stateAtBoundary(track, origin, originState, vector, distance, segmentId, lengthMeters, 1, boundaryStateCache, allowPitOverride);
    return matchesSurfaceChannel(channel, after);
  }
  const before = stateAtBoundary(track, origin, originState, vector, distance, segmentId, lengthMeters, -1, boundaryStateCache, allowPitOverride);
  const after = stateAtBoundary(track, origin, originState, vector, distance, segmentId, lengthMeters, 1, boundaryStateCache, allowPitOverride);
  return matchesSurfaceChannel(channel, before) || matchesSurfaceChannel(channel, after);
}

function prepareBoundaryStateCache(sharedRayQuery) {
  if (!sharedRayQuery) return null;
  const cache = sharedRayQuery.boundaryStateCache ?? {
    distances: [],
    segmentIds: [],
    directions: [],
    states: [],
  };
  sharedRayQuery.boundaryStateCache = cache;
  cache.distances.length = 0;
  cache.segmentIds.length = 0;
  cache.directions.length = 0;
  cache.states.length = 0;
  return cache;
}

function stateAtBoundary(track, origin, originState, vector, distance, segmentId, lengthMeters, direction, boundaryStateCache = null, allowPitOverride = false) {
  if (boundaryStateCache) {
    for (let index = 0; index < boundaryStateCache.distances.length; index += 1) {
      if (
        boundaryStateCache.distances[index] === distance &&
        boundaryStateCache.segmentIds[index] === segmentId &&
        boundaryStateCache.directions[index] === direction
      ) {
        return boundaryStateCache.states[index];
      }
    }
  }
  const epsilon = metersToSimUnits(BOUNDARY_VALIDATION_EPSILON_METERS);
  const maxDistance = metersToSimUnits(lengthMeters);
  const sampleDistance = Math.max(0, Math.min(maxDistance, distance + direction * epsilon));
  const point = {
    x: origin.x + vector.x * sampleDistance,
    y: origin.y + vector.y * sampleDistance,
  };
  const state = indexedBoundaryTrackState(track, point, originState, segmentId, allowPitOverride);
  if (boundaryStateCache) {
    boundaryStateCache.distances.push(distance);
    boundaryStateCache.segmentIds.push(segmentId);
    boundaryStateCache.directions.push(direction);
    boundaryStateCache.states.push(state);
  }
  return state;
}

function indexedBoundaryTrackState(track, point, originState, segmentId, allowPitOverride) {
  const progressHint = originState?.distance;
  if (!canUseIndexedBoundaryProjection(track, point, originState, segmentId)) {
    return nearestTrackState(track, point, progressHint, { allowPitOverride });
  }
  return projectedTrackStateFromSegmentSeed(track, point, progressHint, segmentId, allowPitOverride) ??
    nearestTrackState(track, point, progressHint, { allowPitOverride });
}

function canUseIndexedBoundaryProjection(track, point, originState, segmentId) {
  return point != null &&
    Number.isFinite(originState?.distance) &&
    Number.isInteger(segmentId) &&
    !originState?.inPitLane &&
    !isNearPitConnector(track, originState) &&
    (
      originState.surface !== 'kerb' ||
      Math.abs(originState.curvature ?? 0) <= ANALYTIC_TRACK_RAY_MAX_CURVATURE
    ) &&
    canUseIndexedRecoveryRayApproximation(track, originState);
}

function projectedTrackStateFromSegmentSeed(
  track,
  point,
  progressHint,
  segmentId,
  allowPitOverride,
  cache = null,
) {
  if (
    point == null ||
    !Number.isFinite(progressHint) ||
    !Number.isInteger(segmentId)
  ) {
    return null;
  }
  const projection = querySegmentNeighborhoodProjection(track, point, segmentId, {
    radius: 2,
    preferredDistance: progressHint,
    target: cache?.projection ?? null,
  });
  if (!projection) return null;

  const state = writeTrackState(cache?.state ?? {}, track, point, projection);
  if (!allowPitOverride) return state;

  const pitLane = track?.pitLane;
  if (!pitLane?.enabled || !pointInsideBounds(point, pitLane.bounds)) return state;
  const pitState = nearestPitLaneState(track, point, progressHint);
  if (!pitState) return state;
  return resolveTrackStatePitOverride(track, state, pitState);
}

function matchesSurfaceChannel(channel, state) {
  if (channel === 'kerb') return state?.surface === 'kerb';
  if (channel === 'illegalSurface') return !isLegalRaySurface(state?.surface) && state?.surface !== 'barrier';
  return false;
}

function directTraceFallbackReason({ track, origin, vector, lengthMeters, originState, precision, mainTrackOnly }) {
  if (precision !== 'driver' && precision !== 'debug') return 'precision';
  if (!track?.queryIndex?.centerline?.segmentCount) return 'missing-index';
  if (!Array.isArray(track.samples) || track.samples.length === 0) return 'missing-samples';
  if (!finitePoint(origin) || !finiteVector(vector) || !Number.isFinite(lengthMeters) || lengthMeters < 0) return 'invalid-ray';
  if (!originState || !Number.isFinite(originState.signedOffset) || !Number.isFinite(originState.distance)) return 'invalid-origin-state';
  if (originState.inPitLane) return 'pit-lane';
  if (!mainTrackOnly && isNearPitConnector(track, originState)) return 'pit-connector';
  return null;
}

function directRoadEdgeHit(target, originState, distance, lengthMeters, trackHalfWidth) {
  if (!Number.isFinite(distance)) return writeTrackMiss(target, lengthMeters);
  target.hit = true;
  target.distanceMeters = simUnitsToMeters(distance);
  target.kind = Math.abs(originState.signedOffset ?? 0) <= trackHalfWidth ? 'exit' : 'entry';
  return target;
}

function directKerbHit(target, originState, boundaries, lengthMeters) {
  if (originState.surface === 'kerb') {
    return writeSurfaceHit(target, 0, 'kerb');
  }
  const distance = minFinite(boundaries.trackEdgeDistance, boundaries.kerbOuterDistance);
  if (!Number.isFinite(distance)) return writeSurfaceMiss(target, lengthMeters);
  return writeSurfaceHit(target, simUnitsToMeters(distance), 'kerb');
}

function directIllegalSurfaceHit(target, track, origin, originState, vector, boundaries, lengthMeters, boundaryStateCache) {
  if (!isLegalRaySurface(originState.surface) && originState.surface !== 'barrier') {
    return writeSurfaceHit(target, 0, originState.surface ?? null);
  }
  if (originState.surface === 'barrier') {
    if (!Number.isFinite(boundaries.runoffOuterDistance)) return writeSurfaceMiss(target, lengthMeters);
    return writeSurfaceHit(
      target,
      simUnitsToMeters(boundaries.runoffOuterDistance),
      surfaceAtBoundaryHit(
        track,
        origin,
        originState,
        vector,
        boundaries.runoffOuterDistance,
        boundaries.runoffOuterSegmentId,
        lengthMeters,
        'illegalSurface',
        boundaryStateCache,
      ),
    );
  }
  const distance = boundaries.kerbOuterDistance;
  if (!Number.isFinite(distance)) return writeSurfaceMiss(target, lengthMeters);
  const surface = originState.surface === 'track'
    ? tracerOwnedIllegalSurface(track)
    : null;
  return writeSurfaceHit(
    target,
    simUnitsToMeters(distance),
    surface ?? surfaceAtBoundaryHit(
      track,
      origin,
      originState,
      vector,
      distance,
      boundaries.kerbOuterSegmentId,
      lengthMeters,
      'illegalSurface',
      boundaryStateCache,
    ),
  );
}

function tracerOwnedIllegalSurface(track) {
  if ((track?.gravelWidth ?? 0) > 0) return 'gravel';
  if ((track?.runoffWidth ?? 0) > 0) return 'grass';
  return null;
}

function surfaceAtBoundaryHit(track, origin, originState, vector, distance, segmentId, lengthMeters, channel, boundaryStateCache) {
  const after = stateAtBoundary(track, origin, originState, vector, distance, segmentId, lengthMeters, 1, boundaryStateCache);
  if (matchesSurfaceChannel(channel, after)) return after.surface ?? null;
  const before = stateAtBoundary(track, origin, originState, vector, distance, segmentId, lengthMeters, -1, boundaryStateCache);
  if (matchesSurfaceChannel(channel, before)) return before.surface ?? null;
  return null;
}

function trySampledRecovery({
  track,
  origin,
  vector,
  lengthMeters,
  originState,
  channels,
  allowPitOverride,
  sharedRayQuery,
  reason,
  mainTrackOnly,
  precision,
}) {
  if (!canUseSampledRecovery(reason)) return null;
  const directPitLane = tryDirectPitLaneRecovery({
    vector,
    lengthMeters,
    originState,
    channels,
    sharedRayQuery,
    reason,
  });
  if (directPitLane) return directPitLane;
  if (mainTrackOnly || canUseDirectLocalBandRecovery(track, originState, reason)) {
    const directLocalBand = tryDirectLocalBandRecovery({
      track,
      vector,
      lengthMeters,
      originState,
      channels,
      sharedRayQuery,
      reason,
    });
    if (directLocalBand) return directLocalBand;
  }
  return sampleRayBands({
    track,
    origin,
    vector,
    lengthMeters,
    originState,
    channels,
    allowPitOverride,
    sharedRayQuery,
    reason,
    mainTrackOnly,
    precision,
  });
}

function tryDirectPitLaneRecovery({ vector, lengthMeters, originState, channels, sharedRayQuery, reason }) {
  if (reason !== 'pit-lane' || !originState?.inPitLane) return null;
  const signedOffset = originState.pitLaneSignedOffset ?? originState.signedOffset;
  const roadWidth = originState.pitLaneRoadWidth;
  if (
    !Number.isFinite(signedOffset) ||
    !Number.isFinite(roadWidth) ||
    roadWidth <= 0 ||
    !Number.isFinite(originState.normalX) ||
    !Number.isFinite(originState.normalY)
  ) {
    return null;
  }
  const lateral = vector.x * originState.normalX + vector.y * originState.normalY;
  if (Math.abs(lateral) < 0.05) return null;
  const halfWidth = roadWidth / 2;
  if (Math.abs(signedOffset) > halfWidth + 1e-6) return null;
  const targetOffset = lateral > 0 ? halfWidth : -halfWidth;
  const boundaryDistance = (targetOffset - signedOffset) / lateral;
  if (!Number.isFinite(boundaryDistance) || boundaryDistance < 0) return null;
  const length = metersToSimUnits(lengthMeters);
  const result = prepareTraceResult(sharedRayQuery, lengthMeters);
  const roadEdge = result.roadEdge;
  if (channels.hasRoadEdge && boundaryDistance <= length) {
    roadEdge.hit = true;
    roadEdge.distanceMeters = simUnitsToMeters(boundaryDistance);
    roadEdge.kind = 'exit';
  }
  return writeTraceMeta(result, true, 'direct', null, null);
}

function canUseSampledRecovery(reason) {
  return reason === 'pit-lane' ||
    reason === 'pit-connector' ||
    reason === 'road-edge-recovery' ||
    reason === 'kerb-recovery' ||
    reason === 'illegal-surface-recovery' ||
    reason === 'road-edge-validation' ||
    reason === 'kerb-validation' ||
    reason === 'illegal-surface-validation';
}

function canUseDirectLocalBandRecovery(track, originState, reason) {
  if (
    reason !== 'road-edge-recovery' &&
    reason !== 'kerb-recovery' &&
    reason !== 'illegal-surface-recovery'
  ) {
    return false;
  }
  if (originState?.inPitLane || isNearPitConnector(track, originState)) return false;
  return canUseIndexedRecoveryRayApproximation(track, originState);
}

function tryDirectLocalBandRecovery({ track, vector, lengthMeters, originState, channels, sharedRayQuery, reason }) {
  if (
    reason !== 'road-edge-recovery' &&
    reason !== 'kerb-recovery' &&
    reason !== 'illegal-surface-recovery' &&
    reason !== 'main-track-only'
  ) {
    return null;
  }
  if (
    originState?.inPitLane ||
    !Number.isFinite(originState?.signedOffset) ||
    !Number.isFinite(originState?.normalX) ||
    !Number.isFinite(originState?.normalY) ||
    !canUseIndexedRecoveryRayApproximation(track, originState) ||
    Math.abs(originState.curvature ?? 0) > ANALYTIC_TRACK_RAY_MAX_CURVATURE
  ) {
    return null;
  }
  const lateral = vector.x * originState.normalX + vector.y * originState.normalY;
  if (Math.abs(lateral) < 0.05) return null;

  const maxDistance = metersToSimUnits(lengthMeters);
  const trackHalfWidth = track.width / 2;
  const kerbOuter = trackHalfWidth + (track.kerbWidth ?? 0);
  const offset = originState.signedOffset;
  const result = prepareTraceResult(sharedRayQuery, lengthMeters);

  if (channels.hasRoadEdge) {
    const distance = distanceToAbsBoundary(offset, lateral, trackHalfWidth, maxDistance);
    if (distance != null) {
      result.roadEdge.hit = true;
      result.roadEdge.distanceMeters = simUnitsToMeters(distance);
      result.roadEdge.kind = Math.abs(offset) <= trackHalfWidth ? 'exit' : 'entry';
    } else if (
      Math.abs(offset) > trackHalfWidth &&
      !canUseDirectOutwardRoadEdgeMiss(originState, reason)
    ) {
      return null;
    }
  }

  if (channels.hasKerb) {
    const kerbDistance = distanceToAbsBand(offset, lateral, trackHalfWidth, kerbOuter, maxDistance);
    if (kerbDistance != null) writeSurfaceHit(result.kerb, simUnitsToMeters(kerbDistance), 'kerb');
  }

  if (channels.hasIllegalSurface) {
    if (matchesSurfaceChannel('illegalSurface', originState)) {
      writeSurfaceHit(result.illegalSurface, 0, originState.surface ?? null);
    } else {
      const illegalDistance = distanceToIllegalSurface(offset, lateral, kerbOuter, maxDistance);
      if (illegalDistance != null) {
        writeSurfaceHit(result.illegalSurface, simUnitsToMeters(illegalDistance), tracerOwnedIllegalSurface(track));
      }
    }
  }

  return writeTraceMeta(result, true, 'direct', null, null);
}

function distanceToAbsBand(offset, lateral, minAbsOffset, maxAbsOffset, maxDistance) {
  const currentAbs = Math.abs(offset);
  if (currentAbs >= minAbsOffset && currentAbs <= maxAbsOffset) return 0;
  const enteringBoundary = currentAbs < minAbsOffset ? minAbsOffset : maxAbsOffset;
  return distanceToAbsBoundary(offset, lateral, enteringBoundary, maxDistance);
}

function canUseDirectOutwardRoadEdgeMiss(originState, reason) {
  return reason !== 'main-track-only' &&
    Math.abs(originState?.curvature ?? 0) <= 1e-9;
}

function distanceToIllegalSurface(offset, lateral, kerbOuter, maxDistance) {
  const currentAbs = Math.abs(offset);
  if (currentAbs > kerbOuter) return 0;
  return distanceToAbsBoundary(offset, lateral, kerbOuter, maxDistance);
}

function distanceToAbsBoundary(offset, lateral, targetAbsOffset, maxDistance) {
  let best = Infinity;
  const positive = distanceToOffset(targetAbsOffset, offset, lateral);
  const negative = distanceToOffset(-targetAbsOffset, offset, lateral);
  if (Number.isFinite(positive) && positive >= 0 && positive <= maxDistance) best = positive;
  if (Number.isFinite(negative) && negative >= 0 && negative <= maxDistance && negative < best) best = negative;
  return Number.isFinite(best) ? best : null;
}

function distanceToOffset(targetOffset, offset, lateral) {
  return (targetOffset - offset) / lateral;
}

function sampleRayBands({
  track,
  origin,
  vector,
  lengthMeters,
  originState,
  channels,
  allowPitOverride,
  sharedRayQuery,
  reason,
  mainTrackOnly = false,
  precision = 'driver',
}) {
  const result = prepareTraceResult(sharedRayQuery, lengthMeters);
  const roadEdge = result.roadEdge;
  const kerb = result.kerb;
  const illegalSurface = result.illegalSurface;
  let pendingKerb = false;
  let pendingIllegalSurface = false;
  let pendingSurfaceCount = 0;
  if (channels.hasKerb) {
    if (matchesSurfaceChannel('kerb', originState)) {
      writeSurfaceHit(kerb, 0, originState.surface ?? null);
    } else {
      pendingKerb = true;
      pendingSurfaceCount += 1;
    }
  }
  if (channels.hasIllegalSurface) {
    if (matchesSurfaceChannel('illegalSurface', originState)) {
      writeSurfaceHit(illegalSurface, 0, originState.surface ?? null);
    } else {
      pendingIllegalSurface = true;
      pendingSurfaceCount += 1;
    }
  }

  const maxDistance = metersToSimUnits(lengthMeters);
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  const sampleCache = prepareSampleStateCache(sharedRayQuery);
  const includePitLane = Boolean(originState.inPitLane);
  const needsRoadEdge = channels.hasRoadEdge;
  const localSeedSegmentId = mainTrackOnly && Number.isFinite(originState?.distance)
    ? (Number.isInteger(originState?.segmentId)
      ? originState.segmentId
      : sampleIndexAtDistance(track, originState.distance))
    : (Number.isInteger(originState?.segmentId) ? originState.segmentId : null);
  const useLocalSeedTracking = Number.isInteger(localSeedSegmentId) &&
    canTrackSampledRecoveryFromLocalSegment(track, originState, vector, reason, mainTrackOnly);
  let roadEdgeResolved = !needsRoadEdge;
  let previousDistance = 0;
  let previousState = originState;
  let previousInside = isInsideTrackBorder(originState, track, includePitLane);

  for (let distance = 0; distance <= maxDistance;) {
    const localBatch = distance > 0 && useLocalSeedTracking
      ? stateBatchAtSamples(
        track,
        origin,
        vector,
        distance,
        maxDistance,
        step,
        originState.distance,
        previousState,
        localSeedSegmentId,
        allowPitOverride,
        sampleCache,
      )
      : null;
    const stateCount = localBatch?.count ?? 1;

    for (let stateIndex = 0; stateIndex < stateCount; stateIndex += 1) {
      const currentDistance = distance + step * stateIndex;
      const state = currentDistance === 0
        ? originState
        : localBatch?.states?.[stateIndex] ?? stateAtSample(
          track,
          origin,
          vector,
          currentDistance,
          originState.distance,
          previousState,
          useLocalSeedTracking,
          localSeedSegmentId,
          allowPitOverride,
          sampleCache,
        );

      if (needsRoadEdge && !roadEdgeResolved) {
        const inside = isInsideTrackBorder(state, track, includePitLane);
        if (currentDistance > 0 && inside !== previousInside) {
          roadEdge.hit = true;
          roadEdge.distanceMeters = simUnitsToMeters(refineSampledTransition({
            track,
            origin,
            vector,
            progressHint: originState.distance,
            low: previousDistance,
            high: currentDistance,
            previousMatches: previousInside,
            matches: (candidate) => isInsideTrackBorder(candidate, track, includePitLane),
            allowPitOverride,
            useLocalSeedTracking,
            seedSegmentId: sampledTransitionSegmentId(previousState, state, localSeedSegmentId),
            sampleCache,
            precision,
          }));
          roadEdge.kind = previousInside ? 'exit' : 'entry';
          roadEdgeResolved = true;
        }
        previousInside = inside;
      }

      if (pendingKerb && matchesSurfaceChannel('kerb', state)) {
        const hitDistance = previousState
          ? refineSampledTransition({
            track,
            origin,
            vector,
            progressHint: originState.distance,
            low: previousDistance,
            high: currentDistance,
            previousMatches: false,
            matches: (candidate) => matchesSurfaceChannel('kerb', candidate),
            allowPitOverride,
            useLocalSeedTracking,
            seedSegmentId: sampledTransitionSegmentId(previousState, state, localSeedSegmentId),
            sampleCache,
            precision,
          })
          : currentDistance;
        writeSurfaceHit(kerb, simUnitsToMeters(hitDistance), state.surface ?? null);
        pendingKerb = false;
        pendingSurfaceCount -= 1;
      }

      if (pendingIllegalSurface && matchesSurfaceChannel('illegalSurface', state)) {
        const hitDistance = previousState
          ? refineSampledTransition({
            track,
            origin,
            vector,
            progressHint: originState.distance,
            low: previousDistance,
            high: currentDistance,
            previousMatches: false,
            matches: (candidate) => matchesSurfaceChannel('illegalSurface', candidate),
            allowPitOverride,
            useLocalSeedTracking,
            seedSegmentId: sampledTransitionSegmentId(previousState, state, localSeedSegmentId),
            sampleCache,
            precision,
          })
          : currentDistance;
        writeSurfaceHit(illegalSurface, simUnitsToMeters(hitDistance), state.surface ?? null);
        pendingIllegalSurface = false;
        pendingSurfaceCount -= 1;
      }

      if (roadEdgeResolved && pendingSurfaceCount === 0) {
        distance = maxDistance + step;
        break;
      }
      previousDistance = currentDistance;
      previousState = state;
    }

    distance += step * stateCount;
  }

  return writeTraceMeta(result, true, 'sampled', reason, null);
}

function prepareSampleStateCache(sharedRayQuery) {
  if (!sharedRayQuery) return null;
  const cache = sharedRayQuery.sampleStateCache ?? {
    point: {},
    projection: {},
    state: {},
    batchPoints: [],
    batchProjections: [],
    batchStates: [],
  };
  sharedRayQuery.sampleStateCache = cache;
  return cache;
}

function canTrackSampledRecoveryFromLocalSegment(track, originState, vector, reason, mainTrackOnly) {
  if (!isLocalSegmentTrackableSampleReason(reason)) return false;
  if (originState?.inPitLane) return false;
  if (mainTrackOnly) return true;
  if (Math.abs(originState.curvature ?? 0) > ANALYTIC_TRACK_RAY_MAX_CURVATURE) return false;
  const lateral = vector.x * originState.normalX + vector.y * originState.normalY;
  if (originState.surface === 'kerb' && Math.abs(lateral) < 0.05) return false;
  if (isNearPitConnector(track, originState)) return false;
  return canUseIndexedRecoveryRayApproximation(track, originState);
}

function isLocalSegmentTrackableSampleReason(reason) {
  return reason === 'road-edge-recovery' ||
    reason === 'kerb-recovery' ||
    reason === 'illegal-surface-recovery' ||
    reason === 'road-edge-validation' ||
    reason === 'kerb-validation' ||
    reason === 'illegal-surface-validation';
}

function sampledTransitionSegmentId(previousState, currentState, fallbackSegmentId) {
  if (Number.isInteger(previousState?.segmentId)) return previousState.segmentId;
  if (Number.isInteger(currentState?.segmentId)) return currentState.segmentId;
  return fallbackSegmentId;
}

function stateBatchAtSamples(
  track,
  origin,
  vector,
  startDistance,
  maxDistance,
  step,
  progressHint,
  seedState,
  seedSegmentId,
  allowPitOverride,
  sampleCache,
) {
  const remainingStates = Math.floor((maxDistance - startDistance) / step) + 1;
  const count = Math.max(0, Math.min(LOCAL_SEGMENT_RECOVERY_BATCH_SIZE, remainingStates));
  const batchPoints = sampleCache?.batchPoints ?? [];
  const batchProjections = sampleCache?.batchProjections ?? [];
  const batchStates = sampleCache?.batchStates ?? [];
  batchPoints.length = count;
  batchProjections.length = count;
  batchStates.length = count;

  for (let index = 0; index < count; index += 1) {
    const point = batchPoints[index] ?? {};
    const distance = startDistance + step * index;
    point.x = origin.x + vector.x * distance;
    point.y = origin.y + vector.y * distance;
    batchPoints[index] = point;
  }

  const projections = querySegmentNeighborhoodProjections(
    track,
    batchPoints,
    Number.isInteger(seedState?.segmentId) ? seedState.segmentId : seedSegmentId,
    {
      radius: 2,
      preferredDistance: progressHint,
      target: batchProjections,
    },
  );

  for (let index = 0; index < count; index += 1) {
    const projection = projections?.[index];
    if (!projection) {
      batchStates[index] = nearestTrackState(track, batchPoints[index], progressHint, { allowPitOverride });
      continue;
    }
    batchStates[index] = writeTrackState(batchStates[index] ?? {}, track, batchPoints[index], projection);
  }

  return {
    states: batchStates,
    count,
  };
}

function stateAtSample(
  track,
  origin,
  vector,
  distance,
  progressHint,
  seedState,
  useLocalSeedTracking,
  seedSegmentId,
  allowPitOverride,
  sampleCache,
) {
  const point = sampleCache?.point ?? {};
  point.x = origin.x + vector.x * distance;
  point.y = origin.y + vector.y * distance;
  if (useLocalSeedTracking) {
    const localState = projectedTrackStateFromSegmentSeed(
      track,
      point,
      progressHint,
      Number.isInteger(seedState?.segmentId) ? seedState.segmentId : seedSegmentId,
      allowPitOverride,
      sampleCache,
    );
    if (localState) return localState;
  }
  return nearestTrackState(track, point, progressHint, { allowPitOverride });
}

function refineSampledTransition({
  track,
  origin,
  vector,
  progressHint,
  low,
  high,
  previousMatches,
  matches,
  allowPitOverride,
  useLocalSeedTracking = false,
  seedSegmentId = null,
  sampleCache = null,
  precision = 'driver',
}) {
  const refineSteps = refineStepsForPrecision(precision);
  for (let index = 0; index < refineSteps; index += 1) {
    const middle = (low + high) / 2;
    const point = {
      x: origin.x + vector.x * middle,
      y: origin.y + vector.y * middle,
    };
    const state = useLocalSeedTracking
      ? projectedTrackStateFromSegmentSeed(
        track,
        point,
        progressHint,
        seedSegmentId,
        allowPitOverride,
        sampleCache,
      ) ?? nearestTrackState(track, point, progressHint, { allowPitOverride })
      : nearestTrackState(track, point, progressHint, { allowPitOverride });
    if (matches(state) === previousMatches) low = middle;
    else high = middle;
  }
  return high;
}

function refineStepsForPrecision(precision) {
  return precision === 'debug' ? TRACK_RAY_REFINE_STEPS : DRIVER_RAY_REFINE_STEPS;
}

function isInsideTrackBorder(state, track, includePitLane = false) {
  if (includePitLane && state?.inPitLane) return true;
  return Math.abs(state?.crossTrackError ?? Infinity) <= track.width / 2;
}

function writeTrackMiss(target, lengthMeters) {
  target.hit = false;
  target.distanceMeters = lengthMeters;
  target.kind = null;
  return target;
}

function writeSurfaceMiss(target, lengthMeters) {
  target.hit = false;
  target.distanceMeters = lengthMeters;
  target.surface = null;
  return target;
}

function writeSurfaceHit(target, distanceMeters, surface) {
  target.hit = true;
  target.distanceMeters = distanceMeters;
  target.surface = surface ?? null;
  return target;
}

function minFinite(...values) {
  let minimum = Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (Number.isFinite(value) && value < minimum) minimum = value;
  }
  return Number.isFinite(minimum) ? minimum : null;
}

function nearestBoundaryDistance(firstDistance, firstSegmentId, secondDistance, secondSegmentId) {
  if (!Number.isFinite(firstDistance)) return Number.isFinite(secondDistance) ? secondDistance : null;
  if (!Number.isFinite(secondDistance)) return firstDistance;
  if (!Number.isInteger(firstSegmentId)) return secondDistance;
  if (!Number.isInteger(secondSegmentId)) return firstDistance;
  return firstDistance <= secondDistance ? firstDistance : secondDistance;
}

function nearestBoundarySegmentId(firstDistance, firstSegmentId, secondDistance, secondSegmentId) {
  if (!Number.isFinite(firstDistance)) return Number.isInteger(secondSegmentId) ? secondSegmentId : null;
  if (!Number.isFinite(secondDistance)) return Number.isInteger(firstSegmentId) ? firstSegmentId : null;
  return firstDistance <= secondDistance
    ? (Number.isInteger(firstSegmentId) ? firstSegmentId : null)
    : (Number.isInteger(secondSegmentId) ? secondSegmentId : null);
}

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function finiteVector(vector) {
  return Number.isFinite(vector?.x) && Number.isFinite(vector?.y);
}
