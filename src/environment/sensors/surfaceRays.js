import { nearestTrackState } from '../../simulation/track/trackModel.js';
import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import { TRACK_RAY_REFINE_STEPS, TRACK_RAY_STEP_METERS } from './rayDefaults.js';
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

export function estimateSurfaceHits(car, snapshot, ray, origin, vector, channels) {
  const requested = requestedSurfaceChannels(channels);
  const misses = Object.fromEntries(requested.map((channel) => [channel, createSurfaceMiss(ray.lengthMeters)]));
  if (!requested.length || !Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return misses;
  }

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
