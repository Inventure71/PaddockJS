import { nearestTrackState } from '../../simulation/track/trackModel.js';
import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import {
  ANALYTIC_TRACK_RAY_MAX_CURVATURE,
  PIT_CONNECTOR_RAY_FALLBACK_METERS,
  TRACK_RAY_REFINE_STEPS,
  TRACK_RAY_STEP_METERS,
} from './rayDefaults.js';
import { pointOnRay } from './rayGeometry.js';

const LEGAL_SURFACES = new Set(['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit', 'pit-box']);
const SURFACE_CHANNELS = new Set(['kerb', 'illegalSurface', 'barrier']);

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

export function estimateSurfaceHits(car, snapshot, ray, origin, vector, channels, context = null) {
  const requested = requestedSurfaceChannels(channels);
  const misses = Object.fromEntries(requested.map((channel) => [channel, createSurfaceMiss(ray.lengthMeters)]));
  if (!requested.length || !Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return misses;
  }

  const originState = context?.originState ?? nearestTrackState(snapshot.track, origin, car.progress);
  const analyticHits = estimateAnalyticSurfaceHits({
    car,
    track: snapshot.track,
    ray,
    vector,
    requested,
    originState,
  });
  if (analyticHits) return { ...misses, ...analyticHits };

  const pending = new Set(requested);
  const maxDistance = metersToSimUnits(ray.lengthMeters);
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  let previousDistance = 0;
  let previousState = null;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const state = nearestTrackState(snapshot.track, pointOnRay(origin, vector, distance), car.progress);
    for (const channel of [...pending]) {
      if (!matchesSurfaceChannel(channel, state)) continue;
      const hitDistance = previousState
        ? refineSurfaceTransition(snapshot.track, origin, vector, car.progress, previousDistance, distance, channel)
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

function estimateAnalyticSurfaceHits({ car, track, ray, vector, requested, originState }) {
  if (!originState || car.inPitLane || originState.inPitLane) return null;
  if (!usesMainTrackOnlyRays(car) && isNearPitConnector(track, originState)) return null;
  if (Math.abs(originState.curvature ?? 0) > ANALYTIC_TRACK_RAY_MAX_CURVATURE) return null;

  const lateral = vector.x * originState.normalX + vector.y * originState.normalY;
  if (Math.abs(lateral) < 0.08) return Object.fromEntries(requested.map((channel) => [
    channel,
    createSurfaceMiss(ray.lengthMeters),
  ]));

  const trackHalfWidth = track.width / 2;
  const kerbOuter = trackHalfWidth + (track.kerbWidth ?? 0);
  const barrierStart = kerbOuter + (track.gravelWidth ?? 0) + (track.runoffWidth ?? 0);
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
    } else if (channel === 'barrier') {
      hits[channel] = hitAbsOffsetBand({
        offset,
        lateral,
        minAbsOffset: barrierStart,
        maxAbsOffset: Infinity,
        maxDistance,
        lengthMeters: ray.lengthMeters,
        surface: 'barrier',
      });
    }
  });

  return hits;
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

function refineSurfaceTransition(track, origin, ray, progressHint, lowDistance, highDistance, channel) {
  let low = lowDistance;
  let high = highDistance;
  for (let index = 0; index < TRACK_RAY_REFINE_STEPS; index += 1) {
    const middle = (low + high) / 2;
    const state = nearestTrackState(track, pointOnRay(origin, ray, middle), progressHint);
    if (matchesSurfaceChannel(channel, state)) high = middle;
    else low = middle;
  }
  return high;
}

function matchesSurfaceChannel(channel, state) {
  if (channel === 'kerb') return state.surface === 'kerb';
  if (channel === 'barrier') return state.surface === 'barrier';
  if (channel === 'illegalSurface') return !LEGAL_SURFACES.has(state.surface);
  return false;
}
