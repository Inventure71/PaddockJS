import { nearestTrackState } from '../../simulation/track/trackModel.js';
import { normalizeAngle } from '../../simulation/simMath.js';
import { offsetTrackPoint, pointAt, sampleIndexAtDistance } from '../../simulation/track/spatialQueries.js';
import { pitOverrideAllowedForCar } from '../../simulation/track/trackStatePolicy.js';
import { metersToSimUnits, simUnitsToMeters } from '../../simulation/units.js';
import {
  ANALYTIC_TRACK_RAY_MAX_CURVATURE,
  DRIVER_RAY_REFINE_STEPS,
  TRACK_RAY_REFINE_STEPS,
  TRACK_RAY_STEP_METERS,
} from './rayDefaults.js';
import { canUseIndexedRecoveryRayApproximation } from './rayGuards.js';
import { degreesToRadians, getCarRayOrigin, getCarRayVector, pointOnRay } from './rayGeometry.js';
import { findIndexedTrackBandBoundaries } from './indexedRayBands.js';
import { isNearPitConnector } from './pitConnectorProximity.js';

const RAY_TRACK_STATE_REUSE_POSITION_TOLERANCE = metersToSimUnits(1);
const RAY_TRACK_STATE_REUSE_PROGRESS_TOLERANCE = metersToSimUnits(0.25);
const RAY_TRACK_STATE_REUSE_HEADING_TOLERANCE = 0.02;

export function createTrackRayContext(car, snapshot, origin, precision = 'debug') {
  if (!Array.isArray(snapshot.track?.samples) || snapshot.track.samples.length === 0) {
    return { origin, originState: null, precision };
  }
  const reusedOriginState = reusableRayOriginState(snapshot.track, car, origin);
  return {
    origin,
    originState: reusedOriginState ?? nearestRayTrackState(snapshot.track, car, origin, car.progress),
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
    : nearestRayTrackState(snapshot.track, car, origin, car.progress);
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
    const state = nearestRayTrackState(snapshot.track, car, pointOnRay(origin, ray, distance), car.progress);
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
) {
  let low = lowDistance;
  let high = highDistance;
  for (let index = 0; index < refineSteps; index += 1) {
    const middle = (low + high) / 2;
    const state = nearestRayTrackState(track, car, pointOnRay(origin, ray, middle), progressHint);
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

function nearestRayTrackState(track, car, point, progressHint) {
  return nearestTrackState(track, point, progressHint, {
    allowPitOverride: pitOverrideAllowedForCar(car),
  });
}

function reusableRayOriginState(track, car, origin) {
  const synthesizedState = synthesizedMainRoadRayOriginState(track, car, origin);
  if (synthesizedState) return synthesizedState;
  const trackState = car?.trackState;
  if (!trackState || trackState.inPitLane) return null;
  const mainRoadEdge = track.width / 2 + (track.kerbWidth ?? 0);
  if (!Number.isFinite(trackState.crossTrackError) || trackState.crossTrackError > mainRoadEdge) return null;
  if (
    typeof car?.trackStatePoseX === 'number' &&
    typeof car?.trackStatePoseY === 'number' &&
    typeof car?.trackStatePoseHeading === 'number'
  ) {
    if (
      car.trackStatePoseX !== car.x ||
      car.trackStatePoseY !== car.y ||
      car.trackStatePoseHeading !== car.heading
    ) {
      return null;
    }
    if (!Number.isInteger(trackState.segmentId) && Number.isFinite(trackState.distance)) {
      trackState.segmentId = sampleIndexAtDistance(track, trackState.distance);
    }
  } else {
    if (!Number.isFinite(trackState.distance) || !Number.isFinite(trackState.signedOffset)) return null;
    const base = pointAt(track, trackState.distance);
    const projected = offsetTrackPoint(base, trackState.signedOffset);
    const dx = (origin?.x ?? car?.x ?? 0) - projected.x;
    const dy = (origin?.y ?? car?.y ?? 0) - projected.y;
    if ((dx * dx) + (dy * dy) > RAY_TRACK_STATE_REUSE_POSITION_TOLERANCE * RAY_TRACK_STATE_REUSE_POSITION_TOLERANCE) {
      return null;
    }
    if (wrappedDistanceDelta(trackState.distance, car?.progress, track.length) > RAY_TRACK_STATE_REUSE_PROGRESS_TOLERANCE) {
      return null;
    }
    if (Math.abs(normalizeAngle((trackState.heading ?? base.heading) - base.heading)) > RAY_TRACK_STATE_REUSE_HEADING_TOLERANCE) {
      return null;
    }
    const segmentId = trackState.segmentId ?? sampleIndexAtDistance(track, trackState.distance);
    return {
      segmentId,
      x: base.x,
      y: base.y,
      distance: base.distance,
      heading: base.heading,
      normalX: base.normalX,
      normalY: base.normalY,
      curvature: base.curvature,
      signedOffset: trackState.signedOffset,
      crossTrackError: trackState.crossTrackError,
      surface: trackState.surface ?? 'track',
      onTrack: trackState.surface === 'track' || trackState.surface === 'kerb',
      distanceSquared: trackState.distanceSquared,
      inPitLane: false,
      pitLanePart: null,
      pitBoxId: null,
      mainTrackSignedOffset: trackState.mainTrackSignedOffset,
      mainTrackCrossTrackError: trackState.mainTrackCrossTrackError,
      pitLaneCrossTrackError: trackState.pitLaneCrossTrackError,
    };
  }
  return trackState;
}

function synthesizedMainRoadRayOriginState(track, car, origin) {
  if (!Number.isFinite(car?.progress) || !Number.isFinite(car?.signedOffset)) return null;
  if (car?.inPitLane || car?.pitLanePart) return null;
  const crossTrackError = Math.abs(car.signedOffset);
  const mainRoadEdge = track.width / 2 + (track.kerbWidth ?? 0);
  if (crossTrackError > mainRoadEdge) return null;
  const base = pointAt(track, car.progress);
  const projected = offsetTrackPoint(base, car.signedOffset);
  const dx = (origin?.x ?? car?.x ?? 0) - projected.x;
  const dy = (origin?.y ?? car?.y ?? 0) - projected.y;
  if ((dx * dx) + (dy * dy) > RAY_TRACK_STATE_REUSE_POSITION_TOLERANCE * RAY_TRACK_STATE_REUSE_POSITION_TOLERANCE) {
    return null;
  }
  const segmentId = car?.trackState?.segmentId ?? sampleIndexAtDistance(track, car.progress);
  return {
    segmentId,
    x: base.x,
    y: base.y,
    distance: base.distance,
    heading: base.heading,
    normalX: base.normalX,
    normalY: base.normalY,
    curvature: base.curvature,
    signedOffset: car.signedOffset,
    crossTrackError,
    surface: crossTrackError <= track.width / 2 ? 'track' : 'kerb',
    onTrack: true,
    distanceSquared: car?.trackState?.distanceSquared,
    inPitLane: false,
    pitLanePart: null,
    pitBoxId: null,
    mainTrackSignedOffset: car?.trackState?.mainTrackSignedOffset,
    mainTrackCrossTrackError: car?.trackState?.mainTrackCrossTrackError,
    pitLaneCrossTrackError: car?.trackState?.pitLaneCrossTrackError,
  };
}

function wrappedDistanceDelta(first, second, totalLength) {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return Infinity;
  if (!Number.isFinite(totalLength) || totalLength <= 0) return Math.abs(first - second);
  const delta = Math.abs(first - second);
  return Math.min(delta, totalLength - delta);
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
