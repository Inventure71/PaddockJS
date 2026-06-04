import { nearestTrackState } from '../../simulation/track/trackModel.js';
import { pitOverrideAllowedForCar } from '../../simulation/track/trackStatePolicy.js';
import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import {
  ANALYTIC_TRACK_RAY_MAX_CURVATURE,
  DRIVER_RAY_REFINE_STEPS,
  PIT_CONNECTOR_RAY_FALLBACK_METERS,
  TRACK_RAY_REFINE_STEPS,
  TRACK_RAY_STEP_METERS,
} from './rayDefaults.js';
import { canUseIndexedRecoveryRayApproximation } from './rayGuards.js';
import { pointOnRay } from './rayGeometry.js';
import { findIndexedTrackBandBoundaries } from './indexedRayBands.js';

export function requestedSurfaceChannels(channels = []) {
  const requested = [];
  let hasKerb = false;
  let hasIllegalSurface = false;
  for (let index = 0; index < channels.length; index += 1) {
    const channel = channels[index];
    if (channel === 'kerb' && !hasKerb) {
      requested.push(channel);
      hasKerb = true;
    } else if (channel === 'illegalSurface' && !hasIllegalSurface) {
      requested.push(channel);
      hasIllegalSurface = true;
    }
  }
  return requested;
}

export function createSurfaceMiss(lengthMeters) {
  return {
    hit: false,
    distanceMeters: lengthMeters,
    surface: null,
  };
}

export function estimateSurfaceHits(
  car,
  snapshot,
  ray,
  origin,
  vector,
  channels,
  context = null,
  { precision = 'driver', sharedRayQuery = null } = {},
) {
  const requested = requestedSurfaceChannels(channels);
  const hits = prepareSurfaceHitContainer(sharedRayQuery, ray.lengthMeters);
  if (!requested.length || !Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return hits;
  }

  const originState = context?.precision === precision
    ? context.originState
    : nearestRayTrackState(snapshot.track, car, origin, car.progress, precision);
  writeSurfaceHitsAtOrigin(hits, requested, originState);
  const indexedHits = estimateIndexedSurfaceHits({
    car,
    track: snapshot.track,
    ray,
    origin,
    vector,
    requested,
    originState,
    precision,
    sharedRayQuery,
    hits,
  });
  if (indexedHits) return indexedHits;
  const analyticHits = estimateAnalyticSurfaceHits({
    car,
    track: snapshot.track,
    ray,
    vector,
    requested,
    originState,
    hits,
  });
  if (analyticHits) return analyticHits;

  let pendingKerb = requestedIncludes(requested, 'kerb') && !matchesSurfaceChannel('kerb', originState);
  let pendingIllegalSurface = requestedIncludes(requested, 'illegalSurface') && !matchesSurfaceChannel('illegalSurface', originState);
  if (!pendingKerb && !pendingIllegalSurface) return hits;
  const maxDistance = metersToSimUnits(ray.lengthMeters);
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  let previousDistance = 0;
  let previousState = null;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const state = nearestRayTrackState(snapshot.track, car, pointOnRay(origin, vector, distance), car.progress, precision);
    if (pendingKerb && matchesSurfaceChannel('kerb', state)) {
      const hitDistance = previousState
        ? refineSurfaceTransition(snapshot.track, car, origin, vector, car.progress, previousDistance, distance, 'kerb', refineStepsForPrecision(precision))
        : distance;
      writeSurfaceHit(hits.kerb, simUnitsToMeters(hitDistance), state.surface ?? null);
      pendingKerb = false;
    }
    if (pendingIllegalSurface && matchesSurfaceChannel('illegalSurface', state)) {
      const hitDistance = previousState
        ? refineSurfaceTransition(snapshot.track, car, origin, vector, car.progress, previousDistance, distance, 'illegalSurface', refineStepsForPrecision(precision))
        : distance;
      writeSurfaceHit(hits.illegalSurface, simUnitsToMeters(hitDistance), state.surface ?? null);
      pendingIllegalSurface = false;
    }
    if (!pendingKerb && !pendingIllegalSurface) break;
    previousDistance = distance;
    previousState = state;
  }

  return hits;
}

function prepareSurfaceHitContainer(cache, lengthMeters) {
  const hits = cache
    ? (cache.surfaceHits ?? {})
    : {};
  if (cache) cache.surfaceHits = hits;
  hits.kerb = writeSurfaceMiss(hits.kerb ?? {}, lengthMeters);
  hits.illegalSurface = writeSurfaceMiss(hits.illegalSurface ?? {}, lengthMeters);
  return hits;
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

function writeSurfaceHitsAtOrigin(hits, requested, originState) {
  for (let index = 0; index < requested.length; index += 1) {
    const channel = requested[index];
    if (!matchesSurfaceChannel(channel, originState)) continue;
    writeSurfaceHit(hits[channel], 0, originState.surface ?? null);
  }
}

function estimateAnalyticSurfaceHits({ car, track, ray, vector, requested, originState, hits }) {
  if (!originState || car.inPitLane || originState.inPitLane) return null;
  if (!usesMainTrackOnlyRays(car) && isNearPitConnector(track, originState)) return null;
  if (!canUseIndexedRecoveryRayApproximation(track, originState)) return null;
  if (Math.abs(originState.curvature ?? 0) > ANALYTIC_TRACK_RAY_MAX_CURVATURE) return null;

  const lateral = vector.x * originState.normalX + vector.y * originState.normalY;
  if (Math.abs(lateral) < 0.08) return hits;

  const trackHalfWidth = track.width / 2;
  const kerbOuter = trackHalfWidth + (track.kerbWidth ?? 0);
  const maxDistance = metersToSimUnits(ray.lengthMeters);
  const offset = originState.signedOffset ?? car.signedOffset ?? 0;

  for (let index = 0; index < requested.length; index += 1) {
    const channel = requested[index];
    if (channel === 'kerb') {
      hitAbsOffsetBand(hits.kerb, {
        offset,
        lateral,
        minAbsOffset: trackHalfWidth,
        maxAbsOffset: kerbOuter,
        maxDistance,
        lengthMeters: ray.lengthMeters,
        surface: 'kerb',
      });
    } else if (channel === 'illegalSurface') {
      hitAbsOffsetBand(hits.illegalSurface, {
        offset,
        lateral,
        minAbsOffset: kerbOuter,
        maxAbsOffset: Infinity,
        maxDistance,
        lengthMeters: ray.lengthMeters,
        surface: surfaceBeyondKerb(track, offset, lateral, maxDistance),
      });
    }
  }

  return hits;
}

function estimateIndexedSurfaceHits({ car, track, ray, origin, vector, requested, originState, precision, sharedRayQuery, hits }) {
  if (!originState || car.inPitLane || originState.inPitLane) return null;
  if (!usesMainTrackOnlyRays(car) && isNearPitConnector(track, originState)) return null;

  const trackHalfWidth = track.width / 2;
  const kerbOuter = trackHalfWidth + (track.kerbWidth ?? 0);
  const lateral = vector.x * originState.normalX + vector.y * originState.normalY;
  const boundaries = findIndexedTrackBandBoundaries(
    track,
    origin,
    vector,
    ray.lengthMeters,
    trackHalfWidth,
    kerbOuter,
    sharedRayQuery,
  );
  if (!boundaries.available) return null;

  for (let index = 0; index < requested.length; index += 1) {
    const channel = requested[index];
    if (matchesSurfaceChannel(channel, originState)) {
      writeSurfaceHit(hits[channel], 0, originState.surface ?? null);
      continue;
    }

    const boundaryDistance = channel === 'kerb'
      ? minFinite2(boundaries.trackEdgeDistance, boundaries.kerbOuterDistance)
      : boundaries.kerbOuterDistance;
    if (boundaryDistance == null) {
      if (usesMainTrackOnlyRays(car) && channel === 'illegalSurface') {
        writeSurfaceMiss(hits[channel], ray.lengthMeters);
        continue;
      }
      if (canSampleRecoverySurface(track, originState, vector)) return null;
      writeSurfaceMiss(hits[channel], ray.lengthMeters);
      continue;
    }
    const hitDistance = usesMainTrackOnlyRays(car) || refineStepsForPrecision(precision) <= 0 || precision === 'debug'
      ? boundaryDistance
      : sampledIndexedSurfaceDistance({
        track,
        car,
        origin,
        vector,
        progressHint: car.progress,
        distance: boundaryDistance,
        maxDistance: metersToSimUnits(ray.lengthMeters),
        channel,
        precision,
      });
    if (hitDistance == null) return null;
    writeSurfaceHit(
      hits[channel],
      simUnitsToMeters(hitDistance),
      channel === 'kerb'
        ? 'kerb'
        : surfaceBeyondKerb(track, originState.signedOffset ?? 0, lateral, metersToSimUnits(ray.lengthMeters)),
    );
  }

  return hits;
}

function sampledIndexedSurfaceDistance({
  track,
  car,
  origin,
  vector,
  progressHint,
  distance,
  maxDistance,
  channel,
  precision,
}) {
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  const firstIndex = Math.max(0, Math.floor(Math.max(0, distance - step * 1.5) / step));
  const lastIndex = Math.ceil(Math.min(maxDistance, distance + step * 8) / step);
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const sampleDistance = Math.min(maxDistance, index * step);
    const state = nearestRayTrackState(track, car, pointOnRay(origin, vector, sampleDistance), progressHint, precision);
    if (matchesSurfaceChannel(channel, state)) return sampleDistance;
  }
  return null;
}

function usesMainTrackOnlyRays(car) {
  return car?.interaction?.profile === 'batch-training';
}

function hitAbsOffsetBand(target, { offset, lateral, minAbsOffset, maxAbsOffset, maxDistance, lengthMeters, surface }) {
  const currentAbs = Math.abs(offset);
  if (currentAbs >= minAbsOffset && currentAbs <= maxAbsOffset) {
    return writeSurfaceHit(target, 0, surface);
  }

  let distance = Infinity;
  distance = nearestValidBandDistance(distance, distanceToOffset(minAbsOffset, offset, lateral), offset, lateral, minAbsOffset, maxAbsOffset, maxDistance);
  distance = nearestValidBandDistance(distance, distanceToOffset(-minAbsOffset, offset, lateral), offset, lateral, minAbsOffset, maxAbsOffset, maxDistance);
  if (Number.isFinite(maxAbsOffset)) {
    distance = nearestValidBandDistance(distance, distanceToOffset(maxAbsOffset, offset, lateral), offset, lateral, minAbsOffset, maxAbsOffset, maxDistance);
    distance = nearestValidBandDistance(distance, distanceToOffset(-maxAbsOffset, offset, lateral), offset, lateral, minAbsOffset, maxAbsOffset, maxDistance);
  }

  if (!Number.isFinite(distance)) return writeSurfaceMiss(target, lengthMeters);
  return writeSurfaceHit(target, simUnitsToMeters(distance), surface);
}

function nearestValidBandDistance(current, candidate, offset, lateral, minAbsOffset, maxAbsOffset, maxDistance) {
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > maxDistance || candidate >= current) return current;
  const nextAbs = Math.abs(offset + lateral * candidate);
  return nextAbs >= minAbsOffset - 1e-6 && nextAbs <= maxAbsOffset + 1e-6 ? candidate : current;
}

function distanceToOffset(targetOffset, offset, lateral) {
  return (targetOffset - offset) / lateral;
}

function surfaceBeyondKerb(track, offset, lateral, maxDistance) {
  const gravelOuter = track.width / 2 + (track.kerbWidth ?? 0) + (track.gravelWidth ?? 0);
  const kerbOuter = track.width / 2 + (track.kerbWidth ?? 0);
  const positiveDistance = distanceToOffset(kerbOuter, offset, lateral);
  const negativeDistance = distanceToOffset(-kerbOuter, offset, lateral);
  let hitDistance = Infinity;
  if (Number.isFinite(positiveDistance) && positiveDistance >= 0 && positiveDistance <= maxDistance) {
    hitDistance = positiveDistance;
  }
  if (Number.isFinite(negativeDistance) && negativeDistance >= 0 && negativeDistance <= maxDistance && negativeDistance < hitDistance) {
    hitDistance = negativeDistance;
  }
  const hitAbs = Math.abs(offset + lateral * hitDistance);
  return hitAbs <= gravelOuter ? 'gravel' : 'grass';
}

function isNearPitConnector(track, state) {
  const pitLane = track.pitLane;
  if (!pitLane?.enabled || !Number.isFinite(state?.distance)) return false;
  const window = metersToSimUnits(PIT_CONNECTOR_RAY_FALLBACK_METERS);
  const entryDistance = pitLane.entry?.trackDistance ?? pitLane.entry?.distanceFromStart;
  const exitDistance = pitLane.exit?.trackDistance ?? pitLane.exit?.distanceFromStart;
  return wrappedTrackDistance(state.distance, entryDistance, track.length) <= window ||
    wrappedTrackDistance(state.distance, exitDistance, track.length) <= window;
}

function wrappedTrackDistance(first, second, totalLength) {
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(totalLength) || totalLength <= 0) {
    return Infinity;
  }
  const delta = Math.abs(first - second);
  return Math.min(delta, totalLength - delta);
}

function refineSurfaceTransition(
  track,
  car,
  origin,
  ray,
  progressHint,
  lowDistance,
  highDistance,
  channel,
  refineSteps = TRACK_RAY_REFINE_STEPS,
) {
  let low = lowDistance;
  let high = highDistance;
  for (let index = 0; index < refineSteps; index += 1) {
    const middle = (low + high) / 2;
    const state = nearestRayTrackState(track, car, pointOnRay(origin, ray, middle), progressHint);
    if (matchesSurfaceChannel(channel, state)) high = middle;
    else low = middle;
  }
  return high;
}

function refineStepsForPrecision(precision) {
  return precision === 'debug' ? TRACK_RAY_REFINE_STEPS : DRIVER_RAY_REFINE_STEPS;
}

function matchesSurfaceChannel(channel, state) {
  if (channel === 'kerb') return state.surface === 'kerb';
  if (channel === 'illegalSurface') return !isLegalSurface(state.surface) && state.surface !== 'barrier';
  return false;
}

function requestedIncludes(requested, channel) {
  for (let index = 0; index < requested.length; index += 1) {
    if (requested[index] === channel) return true;
  }
  return false;
}

function isLegalSurface(surface) {
  return surface === 'track' ||
    surface === 'kerb' ||
    surface === 'pit-entry' ||
    surface === 'pit-lane' ||
    surface === 'pit-exit' ||
    surface === 'pit-box';
}

function canSampleRecoverySurface(track, originState, vector) {
  if (!canUseIndexedRecoveryRayApproximation(track, originState)) return false;
  const kerbOuter = track.width / 2 + (track.kerbWidth ?? 0);
  const offset = originState.signedOffset ?? 0;
  if (Math.abs(offset) <= kerbOuter) return false;
  const lateral = vector.x * originState.normalX + vector.y * originState.normalY;
  if (Math.abs(lateral) < 0.05) return false;
  return offset > 0 ? lateral < 0 : lateral > 0;
}

function nearestRayTrackState(track, car, point, progressHint, precision = 'debug') {
  return nearestTrackState(track, point, progressHint, {
    allowPitOverride: pitOverrideAllowedForCar(car),
  });
}

function minFinite2(first, second) {
  if (!Number.isFinite(first)) return Number.isFinite(second) ? second : null;
  if (!Number.isFinite(second)) return first;
  return first <= second ? first : second;
}
