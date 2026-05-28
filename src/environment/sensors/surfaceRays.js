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

const LEGAL_SURFACES = new Set(['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit', 'pit-box']);
const SURFACE_CHANNELS = new Set(['kerb', 'illegalSurface']);

export function requestedSurfaceChannels(channels = []) {
  return channels.filter((channel) => SURFACE_CHANNELS.has(channel));
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
  const misses = Object.fromEntries(requested.map((channel) => [channel, createSurfaceMiss(ray.lengthMeters)]));
  if (!requested.length || !Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return misses;
  }

  const originState = context?.precision === precision
    ? context.originState
    : nearestRayTrackState(snapshot.track, car, origin, car.progress, precision);
  const originHits = surfaceHitsAtOrigin(requested, originState);
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
  });
  if (indexedHits) return { ...misses, ...indexedHits, ...originHits };
  const analyticHits = estimateAnalyticSurfaceHits({
    car,
    track: snapshot.track,
    ray,
    vector,
    requested,
    originState,
  });
  if (analyticHits) return { ...misses, ...analyticHits, ...originHits };

  const pending = new Set(requested);
  Object.keys(originHits).forEach((channel) => {
    misses[channel] = originHits[channel];
    pending.delete(channel);
  });
  if (pending.size === 0) return misses;
  const maxDistance = metersToSimUnits(ray.lengthMeters);
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  let previousDistance = 0;
  let previousState = null;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const state = nearestRayTrackState(snapshot.track, car, pointOnRay(origin, vector, distance), car.progress, precision);
    for (const channel of [...pending]) {
      if (!matchesSurfaceChannel(channel, state)) continue;
      const hitDistance = previousState
        ? refineSurfaceTransition(snapshot.track, car, origin, vector, car.progress, previousDistance, distance, channel, refineStepsForPrecision(precision))
        : distance;
      misses[channel] = {
        hit: true,
        distanceMeters: simUnitsToMeters(hitDistance),
        surface: state.surface ?? null,
      };
      pending.delete(channel);
    }
    if (pending.size === 0) break;
    previousDistance = distance;
    previousState = state;
  }

  return misses;
}

function surfaceHitsAtOrigin(requested, originState) {
  const hits = {};
  requested.forEach((channel) => {
    if (!matchesSurfaceChannel(channel, originState)) return;
    hits[channel] = {
      hit: true,
      distanceMeters: 0,
      surface: originState.surface ?? null,
    };
  });
  return hits;
}

function estimateAnalyticSurfaceHits({ car, track, ray, vector, requested, originState }) {
  if (!originState || car.inPitLane || originState.inPitLane) return null;
  if (!usesMainTrackOnlyRays(car) && isNearPitConnector(track, originState)) return null;
  if (!canUseIndexedRecoveryRayApproximation(track, originState)) return null;
  if (Math.abs(originState.curvature ?? 0) > ANALYTIC_TRACK_RAY_MAX_CURVATURE) return null;

  const lateral = vector.x * originState.normalX + vector.y * originState.normalY;
  if (Math.abs(lateral) < 0.08) return Object.fromEntries(requested.map((channel) => [
    channel,
    createSurfaceMiss(ray.lengthMeters),
  ]));

  const trackHalfWidth = track.width / 2;
  const kerbOuter = trackHalfWidth + (track.kerbWidth ?? 0);
  const maxDistance = metersToSimUnits(ray.lengthMeters);
  const offset = originState.signedOffset ?? car.signedOffset ?? 0;
  const hits = {};

  requested.forEach((channel) => {
    if (channel === 'kerb') {
      hits[channel] = hitAbsOffsetBand({
        offset,
        lateral,
        minAbsOffset: trackHalfWidth,
        maxAbsOffset: kerbOuter,
        maxDistance,
        lengthMeters: ray.lengthMeters,
        surface: 'kerb',
      });
    } else if (channel === 'illegalSurface') {
      hits[channel] = hitAbsOffsetBand({
        offset,
        lateral,
        minAbsOffset: kerbOuter,
        maxAbsOffset: Infinity,
        maxDistance,
        lengthMeters: ray.lengthMeters,
        surface: surfaceBeyondKerb(track, offset, lateral, maxDistance),
      });
    }
  });

  return hits;
}

function estimateIndexedSurfaceHits({ car, track, ray, origin, vector, requested, originState, precision, sharedRayQuery }) {
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
  const hits = {};

  for (const channel of requested) {
    if (matchesSurfaceChannel(channel, originState)) {
      hits[channel] = { hit: true, distanceMeters: 0, surface: originState.surface ?? null };
      continue;
    }

    const boundaryDistance = channel === 'kerb'
      ? minFinite(boundaries.trackEdgeDistance, boundaries.kerbOuterDistance)
      : boundaries.kerbOuterDistance;
    if (boundaryDistance == null) {
      if (usesMainTrackOnlyRays(car) && channel === 'illegalSurface') {
        hits[channel] = createSurfaceMiss(ray.lengthMeters);
        continue;
      }
      if (canSampleRecoverySurface(track, originState, vector)) return null;
      hits[channel] = createSurfaceMiss(ray.lengthMeters);
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
    hits[channel] = {
      hit: true,
      distanceMeters: simUnitsToMeters(hitDistance),
      surface: channel === 'kerb'
        ? 'kerb'
        : surfaceBeyondKerb(track, originState.signedOffset ?? 0, lateral, metersToSimUnits(ray.lengthMeters)),
    };
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

function hitAbsOffsetBand({ offset, lateral, minAbsOffset, maxAbsOffset, maxDistance, lengthMeters, surface }) {
  const currentAbs = Math.abs(offset);
  if (currentAbs >= minAbsOffset && currentAbs <= maxAbsOffset) {
    return { hit: true, distanceMeters: 0, surface };
  }

  const candidates = [
    distanceToOffset(minAbsOffset, offset, lateral),
    distanceToOffset(-minAbsOffset, offset, lateral),
  ].filter((distance) => Number.isFinite(distance) && distance >= 0 && distance <= maxDistance);

  if (Number.isFinite(maxAbsOffset)) {
    candidates.push(
      ...[
        distanceToOffset(maxAbsOffset, offset, lateral),
        distanceToOffset(-maxAbsOffset, offset, lateral),
      ].filter((distance) => Number.isFinite(distance) && distance >= 0 && distance <= maxDistance),
    );
  }

  const distance = candidates
    .filter((candidate) => {
      const nextAbs = Math.abs(offset + lateral * candidate);
      return nextAbs >= minAbsOffset - 1e-6 && nextAbs <= maxAbsOffset + 1e-6;
    })
    .sort((a, b) => a - b)[0];

  if (!Number.isFinite(distance)) return createSurfaceMiss(lengthMeters);
  return { hit: true, distanceMeters: simUnitsToMeters(distance), surface };
}

function distanceToOffset(targetOffset, offset, lateral) {
  return (targetOffset - offset) / lateral;
}

function surfaceBeyondKerb(track, offset, lateral, maxDistance) {
  const gravelOuter = track.width / 2 + (track.kerbWidth ?? 0) + (track.gravelWidth ?? 0);
  const hitDistance = Math.min(
    ...[
      distanceToOffset(track.width / 2 + (track.kerbWidth ?? 0), offset, lateral),
      distanceToOffset(-track.width / 2 - (track.kerbWidth ?? 0), offset, lateral),
    ].filter((distance) => Number.isFinite(distance) && distance >= 0 && distance <= maxDistance),
  );
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
  if (channel === 'illegalSurface') return !LEGAL_SURFACES.has(state.surface) && state.surface !== 'barrier';
  return false;
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

function minFinite(...values) {
  const minimum = Math.min(...values.filter((value) => Number.isFinite(value)));
  return Number.isFinite(minimum) ? minimum : null;
}
