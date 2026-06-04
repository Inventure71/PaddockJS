import { metersToSimUnits } from '../units.js';
import { pointInsideBounds } from './trackMath.js';
import { nearestTrackState, resolveTrackStatePitOverride, writeTrackState } from './spatialQueries.js';
import { nearestPitLaneState } from './pitLaneState.js';
import {
  queryHintedTrackProjection,
  querySegmentNeighborhoodProjection,
  querySegmentNeighborhoodProjections,
} from './trackQueryIndex.js';

const LOCAL_SEGMENT_RADIUS = 3;
const RUNOFF_FAST_PATH_LOCAL_SEGMENT_RADIUS = 2;
const RUNOFF_FAST_PATH_SMALL_MOTION_RADIUS = 1;
const RUNOFF_FAST_PATH_SMALL_MOTION_LIMIT = metersToSimUnits(1.1);
const RUNOFF_FAST_PATH_TELEPORT_LIMIT = metersToSimUnits(80);

export function pitOverrideAllowedForCar(car) {
  if (!car?.environmentControlled) return true;
  const status = car.pitStop?.status ?? null;
  const pitRouteActive = status != null && status !== 'pending' && status !== 'completed';
  const pitIntentCommitted = Number(car.pitStop?.intent ?? car.pitIntent ?? 0) >= 2;
  return pitRouteActive || pitIntentCommitted;
}

export function nearestTrackStateForCar(
  track,
  car,
  position = car,
  progressHint = car?.progress ?? null,
  options = {},
) {
  const resolvedAllowPitOverride = options.allowPitOverride ?? pitOverrideAllowedForCar(car);
  return nearestTrackState(track, position, progressHint, {
    ...options,
    allowPitOverride: resolvedAllowPitOverride,
  });
}

export function queryHintedTrackStateForCar(
  track,
  car,
  position = car,
  progressHint = car?.progress ?? null,
  options = {},
) {
  const resolvedAllowPitOverride = options.allowPitOverride ?? pitOverrideAllowedForCar(car);
  const projection = queryHintedTrackProjection(track, position, progressHint, {
    radius: options.radius ?? 2,
  });
  if (!projection) {
    return nearestTrackState(track, position, progressHint, {
      ...options,
      allowPitOverride: resolvedAllowPitOverride,
    });
  }
  const trackState = writeTrackState(options.target ?? {}, track, position, projection);
  if (!resolvedAllowPitOverride) return trackState;
  return resolveTrackStatePitOverride(track, trackState, nearestPitLaneState(track, position, progressHint));
}

export function queryLocalSegmentTrackStateForCar(
  track,
  car,
  position = car,
  baseSegmentId = car?.trackState?.segmentId ?? null,
  progressHint = car?.progress ?? null,
  options = {},
) {
  const resolvedAllowPitOverride = options.allowPitOverride ?? pitOverrideAllowedForCar(car);
  const indexScratch = track?.queryIndex?.queryScratch;
  const projectionTarget = options.targetProjection ?? (
    indexScratch
      ? (indexScratch.segmentNeighborhoodProjection ??= {})
      : {}
  );
  const projection = querySegmentNeighborhoodProjection(track, position, baseSegmentId, {
    radius: options.radius ?? LOCAL_SEGMENT_RADIUS,
    preferredDistance: progressHint,
    target: projectionTarget,
  });
  if (!projection) {
    return queryHintedTrackStateForCar(track, car, position, progressHint, options);
  }
  const trackState = writeTrackState(options.target ?? {}, track, position, projection);
  return finalizeTrackState(track, position, progressHint, trackState, resolvedAllowPitOverride, options);
}

export function queryLocalSegmentTrackStatesForCar(
  track,
  car,
  positions,
  baseSegmentId = car?.trackState?.segmentId ?? null,
  progressHint = car?.progress ?? null,
  options = {},
) {
  const resolvedAllowPitOverride = options.allowPitOverride ?? pitOverrideAllowedForCar(car);
  const targets = Array.isArray(options.target) ? options.target : new Array(positions.length);
  const projections = queryLocalSegmentTrackProjectionsForCar(
    track,
    car,
    positions,
    baseSegmentId,
    progressHint,
    options,
  );
  if (!projections) {
    for (let index = 0; index < positions.length; index += 1) {
      targets[index] = queryHintedTrackStateForCar(track, car, positions[index], progressHint, options);
    }
    return targets;
  }
  return writeLocalSegmentTrackStatesFromProjections(
    track,
    positions,
    progressHint,
    projections,
    {
      ...options,
      allowPitOverride: resolvedAllowPitOverride,
      target: targets,
    },
  );
}

export function queryLocalSegmentTrackProjectionsForCar(
  track,
  car,
  positions,
  baseSegmentId = car?.trackState?.segmentId ?? null,
  progressHint = car?.progress ?? null,
  options = {},
) {
  if (!Number.isInteger(baseSegmentId)) return null;
  return querySegmentNeighborhoodProjections(track, positions, baseSegmentId, {
    radius: options.radius ?? LOCAL_SEGMENT_RADIUS,
    preferredDistance: progressHint,
    target: options.projections,
  });
}

export function writeLocalSegmentTrackStatesFromProjections(
  track,
  positions,
  progressHint,
  projections,
  options = {},
) {
  if (!Array.isArray(projections)) return null;
  const allowPitOverride = options.allowPitOverride !== false;
  const targets = Array.isArray(options.target) ? options.target : new Array(positions.length);
  for (let index = 0; index < positions.length; index += 1) {
    const projection = projections[index];
    if (!projection) {
      targets[index] = null;
      continue;
    }
    const trackState = writeTrackState(targets[index] ?? {}, track, positions[index], projection);
    targets[index] = finalizeTrackState(track, positions[index], progressHint, trackState, allowPitOverride, options);
  }
  return targets;
}

export function queryRunoffTrackStateForCar(track, car, position = car) {
  const allowPitOverride = pitOverrideAllowedForCar(car);
  const previousState = car?.trackState;
  const progressHint = car?.progress ?? previousState?.distance ?? null;
  const scratch = car?.runoffTrackStateScratch ?? {
    mainTrackState: {},
    result: {
      state: null,
      mainTrackState: null,
      usedFastPathProjection: false,
    },
  };
  if (car && car.runoffTrackStateScratch == null) car.runoffTrackStateScratch = scratch;
  const canUseHintedMainTrack = Number.isFinite(previousState?.distance) &&
    !previousState?.inPitLane &&
    !runoffMotionLooksLikeTeleport(car) &&
    !runoffProgressJumpLooksLikeTeleport(track, previousState, progressHint) &&
    (!allowPitOverride || !pitOverrideMayApply(track, position, previousState));

  if (canUseHintedMainTrack) {
    const localRadius = runoffFastPathLocalSegmentRadius(car);
    const mainTrackState = queryLocalSegmentTrackStateForCar(track, car, position, previousState.segmentId, previousState.distance, {
      allowPitOverride: false,
      radius: localRadius,
      target: scratch.mainTrackState,
    });
    recordRunoffRadiusUsage(track, localRadius);
    scratch.result.state = mainTrackState;
    scratch.result.mainTrackState = mainTrackState;
    scratch.result.usedFastPathProjection = true;
    return scratch.result;
  }

  const state = nearestTrackState(track, position, progressHint, { allowPitOverride });
  const mainTrackState = state.inPitLane
    ? nearestTrackState(track, position, progressHint, { allowPitOverride: false })
    : state;
  scratch.result.state = state;
  scratch.result.mainTrackState = mainTrackState;
  scratch.result.usedFastPathProjection = false;
  return scratch.result;
}

function pitOverrideMayApply(track, position, previousState) {
  const pitLane = track?.pitLane;
  if (!pitLane || !previousState) return false;
  const signedOffset = previousState.signedOffset ?? 0;
  const mainRoadEdge = track.width / 2 + (track.kerbWidth ?? 0);
  if (Math.abs(signedOffset) <= mainRoadEdge) return false;
  if (signedOffset * pitLane.side <= 0) return false;
  const connectorBounds = pitLane.connectorBounds;
  return Boolean(
    connectorBounds && (
      (connectorBounds.entry && pointInsideBounds(position, connectorBounds.entry)) ||
      (connectorBounds.exit && pointInsideBounds(position, connectorBounds.exit))
    ),
  );
}

function runoffMotionLooksLikeTeleport(car) {
  return runoffMotionDistance(car) > RUNOFF_FAST_PATH_TELEPORT_LIMIT;
}

function runoffProgressJumpLooksLikeTeleport(track, previousState, progressHint) {
  if (!Number.isFinite(previousState?.distance) || !Number.isFinite(progressHint)) return true;
  const trackLength = track?.length;
  if (!Number.isFinite(trackLength) || trackLength <= 0) {
    return Math.abs(progressHint - previousState.distance) > RUNOFF_FAST_PATH_TELEPORT_LIMIT;
  }
  const delta = Math.abs(progressHint - previousState.distance);
  return Math.min(delta, trackLength - delta) > RUNOFF_FAST_PATH_TELEPORT_LIMIT;
}

function runoffFastPathLocalSegmentRadius(car) {
  return runoffMotionDistance(car) <= RUNOFF_FAST_PATH_SMALL_MOTION_LIMIT
    ? RUNOFF_FAST_PATH_SMALL_MOTION_RADIUS
    : RUNOFF_FAST_PATH_LOCAL_SEGMENT_RADIUS;
}

function recordRunoffRadiusUsage(track, radius) {
  const stats = track?.queryIndex?.stats;
  if (!stats) return;
  if (radius <= RUNOFF_FAST_PATH_SMALL_MOTION_RADIUS) {
    stats.runoffRadius1Queries = (stats.runoffRadius1Queries ?? 0) + 1;
    return;
  }
  stats.runoffRadius2Queries = (stats.runoffRadius2Queries ?? 0) + 1;
}

function finalizeTrackState(track, position, progressHint, trackState, allowPitOverride, options) {
  if (!allowPitOverride) return trackState;
  if (options.skipPitOverrideInsideMainRoad) {
    const mainRoadEdge = track.width / 2 + (track.kerbWidth ?? 0);
    if (trackState.crossTrackError <= mainRoadEdge) return trackState;
  }
  return resolveTrackStatePitOverride(track, trackState, nearestPitLaneState(track, position, progressHint));
}

function runoffMotionDistance(car) {
  if (
    !Number.isFinite(car?.previousX) ||
    !Number.isFinite(car?.previousY) ||
    !Number.isFinite(car?.x) ||
    !Number.isFinite(car?.y)
  ) return 0;
  const dx = car.x - car.previousX;
  const dy = car.y - car.previousY;
  return Math.hypot(dx, dy);
}
