import { nearestTrackState } from '../../simulation/track/trackModel.js';
import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import {
  ANALYTIC_TRACK_RAY_MAX_CURVATURE,
  PIT_CONNECTOR_RAY_FALLBACK_METERS,
  TRACK_RAY_REFINE_STEPS,
  TRACK_RAY_STEP_METERS,
} from './rayDefaults.js';
import { degreesToRadians, getCarRayOrigin, getCarRayVector, pointOnRay } from './rayGeometry.js';

export function createTrackRayContext(car, snapshot, origin) {
  if (!Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return { origin, originState: null };
  }
  return {
    origin,
    originState: nearestTrackState(snapshot.track, origin, car.progress),
  };
}

export function estimateTrackHit(car, snapshot, angleDegrees, lengthMeters, context = null) {
  if (!Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return estimateLocalTrackHit(car, snapshot, angleDegrees, lengthMeters);
  }

  const origin = context?.origin ?? getCarRayOrigin(car);
  const ray = getCarRayVector(car, angleDegrees);
  const maxDistance = metersToSimUnits(lengthMeters);
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  const originState = context?.originState ?? nearestTrackState(snapshot.track, origin, car.progress);
  const includePitLane = Boolean(car.inPitLane || car.pitLanePart || originState.inPitLane);
  const analyticHit = estimateAnalyticMainTrackHit({
    car,
    track: snapshot.track,
    originState,
    ray,
    lengthMeters,
    includePitLane,
  });
  if (analyticHit) return analyticHit;
  let previousDistance = 0;
  let previousInside = null;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const state = nearestTrackState(snapshot.track, pointOnRay(origin, ray, distance), car.progress);
    const inside = isInsideTrackBorder(state, snapshot.track, includePitLane);
    if (previousInside == null) {
      previousInside = inside;
      previousDistance = distance;
      continue;
    }

    if (inside !== previousInside) {
      const kind = previousInside ? 'exit' : 'entry';
      const hitDistance = refineTrackTransitionDistance(
        snapshot.track,
        origin,
        ray,
        car.progress,
        previousDistance,
        distance,
        kind,
        includePitLane,
      );
      return {
        hit: true,
        distanceMeters: simUnitsToMeters(hitDistance),
        kind,
      };
    }
    previousDistance = distance;
    previousInside = inside;
  }

  return createTrackMiss(lengthMeters);
}

export function createTrackMiss(lengthMeters) {
  return {
    hit: false,
    distanceMeters: lengthMeters,
    kind: null,
  };
}

function estimateAnalyticMainTrackHit({ car, track, originState, ray, lengthMeters, includePitLane }) {
  if (includePitLane || (!usesMainTrackOnlyRays(car) && isNearPitConnector(track, originState))) return null;
  if (Math.abs(originState.curvature ?? 0) > ANALYTIC_TRACK_RAY_MAX_CURVATURE) return null;

  const lateral = ray.x * originState.normalX + ray.y * originState.normalY;
  if (Math.abs(lateral) < 0.08) return createTrackMiss(lengthMeters);

  const trackHalfWidth = track.width / 2;
  const offset = originState.signedOffset ?? car.signedOffset ?? 0;
  const inside = Math.abs(offset) <= trackHalfWidth;
  const targetEdge = getLocalTrackTransitionTarget({
    inside,
    offsetMeters: offset,
    lateral,
    trackHalfWidthMeters: trackHalfWidth,
  });
  if (targetEdge == null) return createTrackMiss(lengthMeters);

  const distance = (targetEdge - offset) / lateral;
  const maxDistance = metersToSimUnits(lengthMeters);
  if (distance < 0 || distance > maxDistance) return createTrackMiss(lengthMeters);

  return {
    hit: true,
    distanceMeters: simUnitsToMeters(distance),
    kind: inside ? 'exit' : 'entry',
  };
}

function usesMainTrackOnlyRays(car) {
  return car?.interaction?.profile === 'batch-training';
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

function estimateLocalTrackHit(car, snapshot, angleDegrees, lengthMeters) {
  const trackHalfWidthMeters = simUnitsToMeters(snapshot.track.width / 2);
  const offsetMeters = simUnitsToMeters(car.signedOffset ?? 0);
  const lateral = Math.sin(degreesToRadians(angleDegrees));
  if (Math.abs(lateral) < 0.08) {
    return createTrackMiss(lengthMeters);
  }

  const inside = Math.abs(offsetMeters) <= trackHalfWidthMeters;
  const targetEdge = getLocalTrackTransitionTarget({ inside, offsetMeters, lateral, trackHalfWidthMeters });
  if (targetEdge == null) return createTrackMiss(lengthMeters);

  const distanceMeters = (targetEdge - offsetMeters) / lateral;
  if (distanceMeters < 0 || distanceMeters > lengthMeters) return createTrackMiss(lengthMeters);

  return {
    hit: true,
    distanceMeters,
    kind: inside ? 'exit' : 'entry',
  };
}

function getLocalTrackTransitionTarget({ inside, offsetMeters, lateral, trackHalfWidthMeters }) {
  if (inside) return lateral > 0 ? trackHalfWidthMeters : -trackHalfWidthMeters;
  if (offsetMeters > trackHalfWidthMeters) return lateral < 0 ? trackHalfWidthMeters : null;
  if (offsetMeters < -trackHalfWidthMeters) return lateral > 0 ? -trackHalfWidthMeters : null;
  return null;
}

function refineTrackTransitionDistance(track, origin, ray, progressHint, lowDistance, highDistance, kind, includePitLane = true) {
  let low = lowDistance;
  let high = highDistance;
  for (let index = 0; index < TRACK_RAY_REFINE_STEPS; index += 1) {
    const middle = (low + high) / 2;
    const state = nearestTrackState(track, pointOnRay(origin, ray, middle), progressHint);
    const inside = isInsideTrackBorder(state, track, includePitLane);
    if (kind === 'entry') {
      if (inside) high = middle;
      else low = middle;
    } else if (inside) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return high;
}

function isInsideTrackBorder(state, track, includePitLane = true) {
  if (includePitLane && state.inPitLane) return true;
  return state.crossTrackError <= track.width / 2;
}
