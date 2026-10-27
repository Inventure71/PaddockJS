import { ensureOrientedRectCorners } from './vehicleGeometry.js';
import { analyticWheelProjectedHalfWidth, wheelFullyOutside, writeAnalyticWheelState } from './mainTrackWheelSurface.js';
import { pitPatchInsideRoad, writeAnalyticPitWheelState } from './pitWheelSurface.js';
import { worstState } from './surfacePriority.js';
import { resetWheelSummary, recordWheelSummary, finishWheelSummary } from './wheelSurfaceSummary.js';
import {
  nearestTrackStateForCar,
  queryHintedTrackStateForCar,
  queryLocalSegmentTrackProjectionsForCar,
  queryLocalSegmentTrackStateForCar,
  queryLocalSegmentTrackStatesForCar,
} from '../track/trackStatePolicy.js';

const STRAIGHT_CONNECTOR_CURVATURE_EPSILON = 1e-8;
const MAIN_TRACK_PATCH_MARGIN = 0.001;

function writeFullWheelState(target, patch, sampledStates, trackLimit) {
  const state = worstState(sampledStates);
  let minimumSignedOffset = Infinity;
  let maximumSignedOffset = -Infinity;
  for (let index = 0; index < sampledStates.length; index += 1) {
    const signedOffset = sampledStates[index].signedOffset;
    if (signedOffset < minimumSignedOffset) minimumSignedOffset = signedOffset;
    if (signedOffset > maximumSignedOffset) maximumSignedOffset = signedOffset;
  }
  const outside = wheelFullyOutside(sampledStates, trackLimit);

  target.id = patch.id;
  target.x = patch.center.x;
  target.y = patch.center.y;
  target.signedOffset = state.signedOffset;
  target.crossTrackError = state.crossTrackError;
  target.surface = state.surface;
  target.onTrack = Boolean(state.onTrack);
  target.inPitLane = Boolean(state.inPitLane);
  target.pitLanePart = state.pitLanePart ?? null;
  target.pitBoxId = state.pitBoxId ?? null;
  target.minimumSignedOffset = minimumSignedOffset;
  target.maximumSignedOffset = maximumSignedOffset;
  target.fullyOutsideWhiteLine = outside.fullyOutsideWhiteLine;
  target.outsideSide = outside.outsideSide;
  target.sampledStates = sampledStates;
  return target;
}

function queryConnectorSampleState(track, car, point, progressHint, centerState) {
  const baseSegmentId = Number.isInteger(centerState?.segmentId) ? centerState.segmentId : null;
  if (baseSegmentId == null) return queryHintedTrackStateForCar(track, car, point, progressHint);
  return queryLocalSegmentTrackStateForCar(
    track,
    car,
    point,
    baseSegmentId,
    progressHint,
    { skipPitOverrideInsideMainRoad: true },
  );
}

function sampleFullConnectorPatchInto(sampledStates, patch, track, car, progressHint, centerState) {
  const corners = ensureOrientedRectCorners(patch);
  sampledStates.length = 1 + corners.length;
  sampledStates[0] = queryConnectorSampleState(track, car, patch.center, progressHint, centerState);
  for (let index = 0; index < corners.length; index += 1) {
    sampledStates[index + 1] = queryConnectorSampleState(track, car, corners[index], progressHint, centerState);
  }
  return sampledStates;
}

function sampleFullNearestPatchInto(sampledStates, patch, track, car) {
  const corners = ensureOrientedRectCorners(patch);
  sampledStates.length = 1 + corners.length;
  sampledStates[0] = nearestTrackStateForCar(track, car, patch.center, car.progress);
  for (let index = 0; index < corners.length; index += 1) {
    sampledStates[index + 1] = nearestTrackStateForCar(track, car, corners[index], car.progress);
  }
  return sampledStates;
}

function writeConnectorWheelState(target, {
  patch,
  wheelCenterState,
  centerState,
  car,
  track,
  trackLimit,
  progressHint,
  sampledStates,
}) {
  if (!wheelCenterState) {
    return writeAnalyticWheelState(target, patch, centerState, track, trackLimit);
  }
  if (!wheelCenterState.inPitLane) {
    return writeAnalyticWheelState(target, patch, wheelCenterState, track, trackLimit);
  }
  if (pitPatchInsideRoad(patch, wheelCenterState)) {
    return writeAnalyticPitWheelState(target, patch, wheelCenterState);
  }
  sampleFullConnectorPatchInto(sampledStates, patch, track, car, progressHint, centerState);
  return writeFullWheelState(target, patch, sampledStates, trackLimit);
}

function collectPatchCenters(target, patches) {
  target.length = patches.length;
  for (let index = 0; index < patches.length; index += 1) {
    target[index] = patches[index].center;
  }
  return target;
}

export function connectorWheelCenterStates(
  track,
  car,
  patches,
  centerState,
  progressHint,
  scratchStates = null,
  scratchProjections = null,
  scratchPositions = null,
) {
  const baseSegmentId = Number.isInteger(centerState?.segmentId) ? centerState.segmentId : null;
  const states = scratchStates ?? new Array(patches.length);
  states.length = patches.length;
  if (baseSegmentId == null) {
    for (let index = 0; index < patches.length; index += 1) {
      states[index] = queryHintedTrackStateForCar(track, car, patches[index].center, progressHint);
    }
    return states;
  }
  const positions = collectPatchCenters(scratchPositions ?? new Array(patches.length), patches);
  return queryLocalSegmentTrackStatesForCar(
    track,
    car,
    positions,
    baseSegmentId,
    progressHint,
    {
      radius: 2,
      skipPitOverrideInsideMainRoad: true,
      target: states,
      projections: scratchProjections,
    },
  );
}

export function connectorWheelCenterProjections(
  track,
  car,
  patches,
  centerState,
  progressHint,
  scratchProjections = null,
  scratchPositions = null,
) {
  const baseSegmentId = Number.isInteger(centerState?.segmentId) ? centerState.segmentId : null;
  if (baseSegmentId == null) return null;
  const positions = collectPatchCenters(scratchPositions ?? new Array(patches.length), patches);
  return queryLocalSegmentTrackProjectionsForCar(
    track,
    car,
    positions,
    baseSegmentId,
    progressHint,
    {
      radius: 2,
      projections: scratchProjections,
    },
  );
}

export function canUseStraightConnectorMainTrackAnalytic(track, geometry, centerState, trackLimit) {
  if (
    !track ||
    !geometry?.contactPatches?.length ||
    !centerState ||
    centerState.inPitLane ||
    !centerState.onTrack ||
    Math.abs(centerState.curvature ?? 0) > STRAIGHT_CONNECTOR_CURVATURE_EPSILON
  ) {
    return false;
  }

  for (let index = 0; index < geometry.contactPatches.length; index += 1) {
    const patch = geometry.contactPatches[index];
    const wheelCenterOffset =
      (patch.center.x - centerState.x) * centerState.normalX +
      (patch.center.y - centerState.y) * centerState.normalY;
    const projectedHalfWidth = analyticWheelProjectedHalfWidth(patch, centerState);
    if (
      wheelCenterOffset - projectedHalfWidth < -trackLimit - MAIN_TRACK_PATCH_MARGIN ||
      wheelCenterOffset + projectedHalfWidth > trackLimit + MAIN_TRACK_PATCH_MARGIN
    ) {
      return false;
    }
  }
  return true;
}

export function writeConnectorWheelStatesWithSummary({
  targetWheels,
  patches,
  wheelCenterStates,
  centerState,
  car,
  track,
  trackLimit,
  progressHint,
  sampledStatePools,
  summaryTarget = null,
}) {
  const summary = resetWheelSummary(summaryTarget ?? {});
  for (let index = 0; index < patches.length; index += 1) {
    const sampledStates = sampledStatePools[index] ?? [];
    sampledStatePools[index] = sampledStates;
    const wheel = writeConnectorWheelState(targetWheels[index], {
      patch: patches[index],
      wheelCenterState: wheelCenterStates[index],
      centerState,
      car,
      track,
      trackLimit,
      progressHint,
      sampledStates,
    });
    recordWheelSummary(summary, wheel);
  }
  finishWheelSummary(summary, track, trackLimit);

  return {
    wheels: targetWheels,
    effectiveSurface: summary.effectiveSurface,
    representative: summary.representative,
    trackLimits: summary.trackLimits,
    allOnTrackOrPit: summary.allOnTrackOrPit,
    allInPitLane: summary.allInPitLane,
  };
}

export function writeNearestSampledWheelStatesWithSummary({
  targetWheels,
  patches,
  car,
  track,
  trackLimit,
  sampledStatePools,
  summaryTarget = null,
}) {
  const summary = resetWheelSummary(summaryTarget ?? {});
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index];
    const sampledStates = sampledStatePools[index] ?? [];
    sampledStatePools[index] = sampledStates;
    sampleFullNearestPatchInto(sampledStates, patch, track, car);
    const wheel = writeFullWheelState(targetWheels[index], patch, sampledStates, trackLimit);
    recordWheelSummary(summary, wheel);
  }
  finishWheelSummary(summary, track, trackLimit);

  return {
    wheels: targetWheels,
    effectiveSurface: summary.effectiveSurface,
    representative: summary.representative,
    trackLimits: summary.trackLimits,
    allOnTrackOrPit: summary.allOnTrackOrPit,
    allInPitLane: summary.allInPitLane,
  };
}
