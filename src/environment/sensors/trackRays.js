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
import { degreesToRadians, getCarRayOrigin, getCarRayVector, pointOnRay } from './rayGeometry.js';
import { findIndexedTrackBandBoundaries } from './indexedRayBands.js';

export function createTrackRayContext(car, snapshot, origin, precision = 'debug') {
  if (!Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return { origin, originState: null, precision };
  }
  return {
    origin,
    originState: nearestRayTrackState(snapshot.track, car, origin, car.progress, precision),
    precision,
  };
}

export function estimateTrackHit(
  car,
  snapshot,
  angleDegrees,
  lengthMeters,
  context = null,
  { precision = 'driver', sharedRayQuery = null } = {},
) {
  if (!Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return estimateLocalTrackHit(car, snapshot, angleDegrees, lengthMeters);
  }

  const origin = context?.origin ?? getCarRayOrigin(car);
  const ray = getCarRayVector(car, angleDegrees);
  const maxDistance = metersToSimUnits(lengthMeters);
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  const originState = context?.precision === precision
    ? context.originState
    : nearestRayTrackState(snapshot.track, car, origin, car.progress, precision);
  const includePitLane = Boolean(car.inPitLane || car.pitLanePart || originState.inPitLane);
  const indexedHit = estimateIndexedTrackHit({
    car,
    track: snapshot.track,
    origin,
    originState,
    ray,
    lengthMeters,
    includePitLane,
    precision,
    sharedRayQuery,
  });
  if (indexedHit) return indexedHit;
  const directionalAnalyticHit = canUseDirectionalAnalyticTrackHit({ car, track: snapshot.track, originState, ray, includePitLane })
    ? estimateAnalyticMainTrackHit({
      car,
      track: snapshot.track,
      origin,
      originState,
      ray,
      lengthMeters,
      includePitLane,
    })
    : null;
  if (directionalAnalyticHit) return directionalAnalyticHit;
  const analyticHit = estimateAnalyticMainTrackHit({
    car,
    track: snapshot.track,
    origin,
    originState,
    ray,
    lengthMeters,
    includePitLane,
  });
  if (analyticHit) return analyticHit;
  let previousDistance = 0;
  let previousInside = null;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const state = nearestRayTrackState(snapshot.track, car, pointOnRay(origin, ray, distance), car.progress, precision);
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
        car,
        origin,
        ray,
        car.progress,
        previousDistance,
        distance,
        kind,
        includePitLane,
        refineStepsForPrecision(precision),
        precision,
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

function estimateAnalyticMainTrackHit({ car, track, origin, originState, ray, lengthMeters, includePitLane }) {
  if (includePitLane || (!usesMainTrackOnlyRays(car) && isNearPitConnector(track, originState))) return null;
  if (!canUseIndexedRecoveryRayApproximation(track, originState)) return null;
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

function canUseDirectionalAnalyticTrackHit({ car, track, originState, ray, includePitLane }) {
  if (includePitLane || (!usesMainTrackOnlyRays(car) && isNearPitConnector(track, originState))) return false;
  if (!canUseIndexedRecoveryRayApproximation(track, originState)) return false;
  if (Math.abs(originState.curvature ?? 0) > ANALYTIC_TRACK_RAY_MAX_CURVATURE) return false;

  const lateral = ray.x * originState.normalX + ray.y * originState.normalY;
  return Math.abs(lateral) >= 0.08;
}

function estimateIndexedTrackHit({ car, track, origin, originState, ray, lengthMeters, includePitLane, precision, sharedRayQuery }) {
  if (includePitLane || (!usesMainTrackOnlyRays(car) && isNearPitConnector(track, originState))) return null;
  const trackHalfWidth = track.width / 2;
  const inside = Math.abs(originState.signedOffset ?? 0) <= trackHalfWidth;
  const boundaries = findIndexedTrackBandBoundaries(
    track,
    origin,
    ray,
    lengthMeters,
    trackHalfWidth,
    trackHalfWidth + (track.kerbWidth ?? 0),
    sharedRayQuery,
  );
  if (!boundaries.available) return null;
  if (boundaries.trackEdgeDistance == null) {
    if (usesMainTrackOnlyRays(car)) return createTrackMiss(lengthMeters);
    return canSampleRecoveryTransition(track, originState, ray)
      ? null
      : createTrackMiss(lengthMeters);
  }
  const kind = inside ? 'exit' : 'entry';
  const hitDistance = usesMainTrackOnlyRays(car)
    ? boundaries.trackEdgeDistance
    : validatedIndexedTransitionDistance({
      track,
      car,
      origin,
      ray,
      progressHint: car.progress,
      distance: boundaries.trackEdgeDistance,
      maxDistance: metersToSimUnits(lengthMeters),
      kind,
      includePitLane,
      precision,
      originInside: inside,
    });
  if (hitDistance == null) return null;
  return {
    hit: true,
    distanceMeters: simUnitsToMeters(hitDistance),
    kind,
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

function refineTrackTransitionDistance(
  track,
  car,
  origin,
  ray,
  progressHint,
  lowDistance,
  highDistance,
  kind,
  includePitLane = true,
  refineSteps = TRACK_RAY_REFINE_STEPS,
  precision = 'debug',
) {
  let low = lowDistance;
  let high = highDistance;
  for (let index = 0; index < refineSteps; index += 1) {
    const middle = (low + high) / 2;
    const state = nearestRayTrackState(track, car, pointOnRay(origin, ray, middle), progressHint, precision);
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

function nearestRayTrackState(track, car, point, progressHint, precision = 'debug') {
  return nearestTrackState(track, point, progressHint, {
    allowPitOverride: pitOverrideAllowedForCar(car),
  });
}

function refineStepsForPrecision(precision) {
  return precision === 'debug' ? TRACK_RAY_REFINE_STEPS : DRIVER_RAY_REFINE_STEPS;
}

function isInsideTrackBorder(state, track, includePitLane = true) {
  if (includePitLane && state.inPitLane) return true;
  return state.crossTrackError <= track.width / 2;
}

function canSampleRecoveryTransition(track, originState, ray) {
  if (!canUseIndexedRecoveryRayApproximation(track, originState)) return false;
  const trackHalfWidth = track.width / 2;
  const offset = originState.signedOffset ?? 0;
  if (Math.abs(offset) <= trackHalfWidth) return false;
  const lateral = ray.x * originState.normalX + ray.y * originState.normalY;
  if (Math.abs(lateral) < 0.05) return false;
  return offset > 0 ? lateral < 0 : lateral > 0;
}

function validatedIndexedTransitionDistance({
  track,
  car,
  origin,
  ray,
  progressHint,
  distance,
  maxDistance,
  kind,
  includePitLane,
  precision = 'driver',
  originInside = kind === 'exit',
}) {
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  const refineSteps = refineStepsForPrecision(precision);
  if (refineSteps <= 0) {
    return distance;
  }

  const windows = [step * 1.5, step * 8];

  for (const searchWindow of windows) {
    const low = Math.max(0, distance - searchWindow);
    const high = Math.min(maxDistance, distance + searchWindow);
    if (high <= low) continue;
    const previousInside = validatedInsideTrackBorder(track, car, origin, ray, low, progressHint, includePitLane);
    const inside = validatedInsideTrackBorder(track, car, origin, ray, high, progressHint, includePitLane);
    const matched = kind === 'entry'
      ? !previousInside && inside
      : previousInside && !inside;
    if (matched) {
      if (refineSteps <= 0) return distance;
      return refineValidatedTransitionDistance(
        track,
        car,
        origin,
        ray,
        progressHint,
        low,
        high,
        kind,
        includePitLane,
        refineSteps,
      );
    }
  }

  return null;
}

function sampledIndexedTransitionDistance({
  track,
  car,
  origin,
  ray,
  progressHint,
  distance,
  maxDistance,
  kind,
  includePitLane,
}) {
  const step = metersToSimUnits(TRACK_RAY_STEP_METERS);
  const firstIndex = Math.max(1, Math.floor(Math.max(0, distance - step * 1.5) / step));
  const lastIndex = Math.ceil(Math.min(maxDistance, distance + step * 8) / step);
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const high = Math.min(maxDistance, index * step);
    const low = Math.max(0, high - step);
    if (high <= low) continue;
    const previousInside = validatedInsideTrackBorder(track, car, origin, ray, low, progressHint, includePitLane);
    const inside = validatedInsideTrackBorder(track, car, origin, ray, high, progressHint, includePitLane);
    const matched = kind === 'entry'
      ? !previousInside && inside
      : previousInside && !inside;
    if (matched) return high;
  }
  return null;
}

function refineValidatedTransitionDistance(track, car, origin, ray, progressHint, lowDistance, highDistance, kind, includePitLane, refineSteps) {
  let low = lowDistance;
  let high = highDistance;
  for (let index = 0; index < refineSteps; index += 1) {
    const middle = (low + high) / 2;
    const inside = validatedInsideTrackBorder(track, car, origin, ray, middle, progressHint, includePitLane);
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

function validatedInsideTrackBorder(track, car, origin, ray, distance, progressHint, includePitLane) {
  const state = nearestTrackState(track, pointOnRay(origin, ray, distance), progressHint, {
    allowPitOverride: pitOverrideAllowedForCar(car),
  });
  return isInsideTrackBorder(state, track, includePitLane);
}
