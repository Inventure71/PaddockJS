import { ensureOrientedRectCorners, getCurrentVehicleGeometryState } from './vehicleGeometry.js';
import {
  analyticWheelProjectedHalfWidth,
  wheelFullyOutside,
  writeAnalyticWheelState,
  writeAnalyticWheelStateWithProjectedHalfWidth,
} from './mainTrackWheelSurface.js';
import {
  canUseAnalyticPitWheels,
  canSkipConnectorPitChecks,
  isNearPitConnector,
  pitPatchInsideRoad,
  writeAnalyticPitWheelState,
} from './pitWheelSurface.js';
import { getEffectiveSurface, priority, worstState } from './surfacePriority.js';
import {
  nearestTrackStateForCar,
  pitOverrideAllowedForCar,
  queryHintedTrackStateForCar,
  queryLocalSegmentTrackProjectionsForCar,
  queryLocalSegmentTrackStateForCar,
  queryLocalSegmentTrackStatesForCar,
  queryRunoffTrackStateForCar,
  writeLocalSegmentTrackStatesFromProjections,
} from '../track/trackStatePolicy.js';

export { getEffectiveSurface } from './surfacePriority.js';

const STRAIGHT_CONNECTOR_CURVATURE_EPSILON = 1e-8;
const MAIN_TRACK_PATCH_MARGIN = 0.001;

function usesAutomaticCenterState(centerState, cacheAsAuto = false) {
  return cacheAsAuto || centerState == null;
}

function cacheMatchesCenterState(cache, centerState, cacheAsAuto = false) {
  const automatic = usesAutomaticCenterState(centerState, cacheAsAuto);
  if ((cache.centerStateAuto ?? true) !== automatic) return false;
  if (automatic) return true;
  return cache.centerStateDistance === centerState.distance &&
    cache.centerStateSignedOffset === centerState.signedOffset &&
    cache.centerStateCrossTrackError === centerState.crossTrackError &&
    cache.centerStateSurface === (centerState.surface ?? null) &&
    cache.centerStateInPitLane === Boolean(centerState.inPitLane) &&
    cache.centerStatePitLanePart === (centerState.pitLanePart ?? null) &&
    cache.centerStatePitBoxId === (centerState.pitBoxId ?? null);
}

function writeCachedCenterState(cache, centerState, cacheAsAuto = false) {
  const automatic = usesAutomaticCenterState(centerState, cacheAsAuto);
  cache.centerStateAuto = automatic;
  if (automatic) {
    cache.centerStateDistance = null;
    cache.centerStateSignedOffset = null;
    cache.centerStateCrossTrackError = null;
    cache.centerStateSurface = null;
    cache.centerStateInPitLane = false;
    cache.centerStatePitLanePart = null;
    cache.centerStatePitBoxId = null;
    return cache;
  }
  cache.centerStateDistance = centerState.distance;
  cache.centerStateSignedOffset = centerState.signedOffset;
  cache.centerStateCrossTrackError = centerState.crossTrackError;
  cache.centerStateSurface = centerState.surface ?? null;
  cache.centerStateInPitLane = Boolean(centerState.inPitLane);
  cache.centerStatePitLanePart = centerState.pitLanePart ?? null;
  cache.centerStatePitBoxId = centerState.pitBoxId ?? null;
  return cache;
}

function canRefreshAutomaticCenterStateFromTrackState(car, track) {
  const trackState = car?.trackState;
  if (!trackState || trackState.inPitLane) return false;
  if (
    car?.trackStatePoseX !== car?.x ||
    car?.trackStatePoseY !== car?.y ||
    car?.trackStatePoseHeading !== car?.heading
  ) {
    return false;
  }
  const mainRoadEdge = track.width / 2 + (track.kerbWidth ?? 0);
  return Number.isFinite(trackState.crossTrackError) && trackState.crossTrackError <= mainRoadEdge;
}

function writeRepresentativeTrackState(target, centerState, effectiveSurface, representative, onTrack, inPitLane) {
  target.segmentId = centerState.segmentId;
  target.x = centerState.x;
  target.y = centerState.y;
  target.distance = centerState.distance;
  target.heading = centerState.heading;
  target.normalX = centerState.normalX;
  target.normalY = centerState.normalY;
  target.curvature = centerState.curvature;
  target.signedOffset = representative.signedOffset;
  target.crossTrackError = representative.crossTrackError;
  target.surface = effectiveSurface;
  target.onTrack = onTrack;
  target.distanceSquared = centerState.distanceSquared;
  target.inPitLane = inPitLane;
  target.pitLanePart = centerState.pitLanePart;
  target.pitBoxId = centerState.pitBoxId;
  target.mainTrackSignedOffset = centerState.mainTrackSignedOffset;
  target.mainTrackCrossTrackError = centerState.mainTrackCrossTrackError;
  target.pitLaneCrossTrackError = centerState.pitLaneCrossTrackError;
  target.wheelSurface = effectiveSurface;
  return target;
}

function prepareScratchWheels(scratch, count) {
  if (!scratch) return null;
  const wheels = scratch.wheels ?? [];
  const wheelPool = scratch.wheelPool ?? [];
  scratch.wheels = wheels;
  scratch.wheelPool = wheelPool;
  wheels.length = count;
  for (let index = 0; index < count; index += 1) {
    const wheel = wheelPool[index] ?? {};
    wheelPool[index] = wheel;
    wheels[index] = wheel;
  }
  return wheels;
}

function recordScratchlessScalarWheelBatch(car, wheelCount) {
  const stats = car?.runtimeBenchmarkStats;
  if (!stats) return;
  stats.scratchlessScalarWheelBatches = (stats.scratchlessScalarWheelBatches ?? 0) + 1;
  stats.scratchlessScalarWheelWrites = (stats.scratchlessScalarWheelWrites ?? 0) + wheelCount;
}

function createWheelTargets(count) {
  const wheels = new Array(count);
  for (let index = 0; index < count; index += 1) {
    wheels[index] = {};
  }
  return wheels;
}

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

function resetWheelSummary(summary) {
  const trackLimits = summary.trackLimits ?? {
    violating: false,
    side: 0,
    outsideBy: 0,
  };
  summary.effectiveSurface = 'track';
  summary.effectivePriority = priority(summary.effectiveSurface);
  summary.representative = null;
  summary.allRightOutside = true;
  summary.allLeftOutside = true;
  summary.allOnTrackOrPit = true;
  summary.allInPitLane = true;
  summary.minimumSignedOffset = Infinity;
  summary.maximumSignedOffset = -Infinity;
  summary.trackLimits = trackLimits;
  return summary;
}

function prepareWheelSummary(scratch) {
  if (!scratch) return null;
  const summary = scratch.summary ?? {};
  scratch.summary = summary;
  return resetWheelSummary(summary);
}

function recordWheelSummary(summary, wheel) {
  const wheelPriority = priority(wheel.surface);
  if (wheelPriority > summary.effectivePriority) {
    summary.effectivePriority = wheelPriority;
    summary.effectiveSurface = wheel.surface;
  }
  if (!summary.representative || Math.abs(wheel.signedOffset) > Math.abs(summary.representative.signedOffset)) {
    summary.representative = wheel;
  }
  if (wheel.outsideSide !== 1) summary.allRightOutside = false;
  if (wheel.outsideSide !== -1) summary.allLeftOutside = false;
  if (!(wheel.onTrack || wheel.inPitLane)) summary.allOnTrackOrPit = false;
  if (!wheel.inPitLane) summary.allInPitLane = false;
  if (wheel.minimumSignedOffset < summary.minimumSignedOffset) summary.minimumSignedOffset = wheel.minimumSignedOffset;
  if (wheel.maximumSignedOffset > summary.maximumSignedOffset) summary.maximumSignedOffset = wheel.maximumSignedOffset;
  return summary;
}

function finishWheelSummary(summary, track, trackLimit = track?.width / 2) {
  const trackLimits = summary.trackLimits;
  trackLimits.violating = false;
  trackLimits.side = 0;
  trackLimits.outsideBy = 0;
  if (track && (summary.allRightOutside || summary.allLeftOutside)) {
    const side = summary.allRightOutside ? 1 : -1;
    const outsideBy = summary.allRightOutside
      ? summary.minimumSignedOffset - trackLimit
      : -trackLimit - summary.maximumSignedOffset;
    trackLimits.violating = outsideBy > 0;
    trackLimits.side = side;
    trackLimits.outsideBy = Math.max(0, outsideBy);
  }
  return summary;
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

function connectorWheelCenterStates(
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

function connectorWheelCenterProjections(
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

function canUseStraightConnectorMainTrackAnalytic(track, geometry, centerState, trackLimit) {
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

export function isWholeCarOutsideTrackLimits(wheels = [], track, relaxedMargin = 0) {
  if (!wheels.length || !track) {
    return {
      violating: false,
      side: 0,
      outsideBy: 0,
    };
  }
  const trackLimit = track.width / 2 + relaxedMargin;
  let right = true;
  let left = true;
  let minimumSignedOffset = Infinity;
  let maximumSignedOffset = -Infinity;
  for (let index = 0; index < wheels.length; index += 1) {
    const wheel = wheels[index];
    if (wheel.outsideSide !== 1) right = false;
    if (wheel.outsideSide !== -1) left = false;
    if (wheel.minimumSignedOffset < minimumSignedOffset) minimumSignedOffset = wheel.minimumSignedOffset;
    if (wheel.maximumSignedOffset > maximumSignedOffset) maximumSignedOffset = wheel.maximumSignedOffset;
  }
  if (!right && !left) {
    return {
      violating: false,
      side: 0,
      outsideBy: 0,
    };
  }
  const side = right ? 1 : -1;
  const outsideBy = right
    ? minimumSignedOffset - trackLimit
    : -trackLimit - maximumSignedOffset;

  return {
    violating: outsideBy > 0,
    side,
    outsideBy: Math.max(0, outsideBy),
  };
}

function writeAnalyticWheelStatesWithSummary(targetWheels, patches, centerState, track, trackLimit, summaryTarget = null) {
  const sharedProjectedHalfWidth = patches.length > 0
    ? analyticWheelProjectedHalfWidth(patches[0], centerState)
    : 0;
  const summary = resetWheelSummary(summaryTarget ?? {});

  for (let index = 0; index < patches.length; index += 1) {
    const wheel = writeAnalyticWheelStateWithProjectedHalfWidth(
      targetWheels[index],
      patches[index],
      centerState,
      track,
      trackLimit,
      sharedProjectedHalfWidth,
    );
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

function writeAnalyticPitWheelStatesWithSummary(targetWheels, patches, centerState, track, trackLimit, summaryTarget = null) {
  const summary = resetWheelSummary(summaryTarget ?? {});

  for (let index = 0; index < patches.length; index += 1) {
    const wheel = writeAnalyticPitWheelState(targetWheels[index], patches[index], centerState);
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

function writeAnalyticWheelStatesFromTrackStatesWithSummary(
  targetWheels,
  patches,
  wheelTrackStates,
  track,
  trackLimit,
  summaryTarget = null,
) {
  const summary = resetWheelSummary(summaryTarget ?? {});

  for (let index = 0; index < patches.length; index += 1) {
    const wheel = writeAnalyticWheelState(
      targetWheels[index],
      patches[index],
      wheelTrackStates[index],
      track,
      trackLimit,
    );
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

function writeConnectorWheelStatesWithSummary({
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

function writeNearestSampledWheelStatesWithSummary({
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

export function calculateWheelSurfaceState({
  car,
  track,
  centerState: providedCenterState = null,
  geometry: providedGeometry = null,
  scratch = null,
  allowPitOverride: providedAllowPitOverride = null,
  trackStateTarget = null,
}) {
  const geometry = providedGeometry ?? getCurrentVehicleGeometryState(car);
  const trackLimit = track.width / 2;
  const allowPitOverride = providedAllowPitOverride ?? pitOverrideAllowedForCar(car);
  const centerState = providedCenterState == null
    ? canRefreshAutomaticCenterStateFromTrackState(car, track)
      ? car.trackState
      : nearestTrackStateForCar(track, car, car, car.progress, { allowPitOverride })
    : !allowPitOverride && providedCenterState.inPitLane
      ? nearestTrackStateForCar(track, car, car, car.progress, { allowPitOverride: false })
      : providedCenterState;
  const nearPitConnector = !centerState.inPitLane && isNearPitConnector(track, centerState);
  const scratchWheels = prepareScratchWheels(scratch, geometry.contactPatches.length);
  const scratchSummary = prepareWheelSummary(scratch);

  if (!centerState.inPitLane && !nearPitConnector) {
    const wheels = scratchWheels ?? createWheelTargets(geometry.contactPatches.length);
    if (!scratchWheels) recordScratchlessScalarWheelBatch(car, geometry.contactPatches.length);
    const summary = writeAnalyticWheelStatesWithSummary(
      wheels,
      geometry.contactPatches,
      centerState,
      track,
      trackLimit,
      scratchSummary,
    );
    return {
      wheels,
      effectiveSurface: summary.effectiveSurface,
      trackLimits: summary.trackLimits,
      sampleMode: 'analytic',
      representativeState: writeRepresentativeTrackState(
        trackStateTarget ?? {},
        centerState,
        summary.effectiveSurface,
        summary.representative,
        summary.allOnTrackOrPit,
        false,
      ),
    };
  }

  const useAnalyticPitSampling = canUseAnalyticPitWheels(geometry, centerState);
  const useConnectorSampling = !useAnalyticPitSampling && nearPitConnector;
  const connectorPitChecksSkipped = useConnectorSampling && canSkipConnectorPitChecks(track, geometry, centerState);
  const connectorStraightMainTrackAnalytic = useConnectorSampling &&
    !connectorPitChecksSkipped &&
    canUseStraightConnectorMainTrackAnalytic(track, geometry, centerState, trackLimit);
  const useFullSampling = !useAnalyticPitSampling && !useConnectorSampling && centerState.inPitLane;
  const connectorProgressHint = centerState.distance ?? car.progress ?? null;
  let analyticSummary = null;
  const wheels = scratchWheels ?? createWheelTargets(geometry.contactPatches.length);
  if (scratchWheels) {
    if (useAnalyticPitSampling) {
      analyticSummary = writeAnalyticPitWheelStatesWithSummary(
        scratchWheels,
        geometry.contactPatches,
        centerState,
        track,
        trackLimit,
        scratchSummary,
      );
    } else if (connectorPitChecksSkipped || connectorStraightMainTrackAnalytic) {
      analyticSummary = writeAnalyticWheelStatesWithSummary(
        scratchWheels,
        geometry.contactPatches,
        centerState,
        track,
        trackLimit,
        scratchSummary,
      );
    } else if (useConnectorSampling) {
      const sampledStatePools = scratch.sampledStatePools ?? [];
      const connectorProjectionPools = scratch.connectorProjectionPools ?? [];
      const connectorPositionPools = scratch.connectorPositionPools ?? [];
      scratch.sampledStatePools = sampledStatePools;
      scratch.connectorProjectionPools = connectorProjectionPools;
      scratch.connectorPositionPools = connectorPositionPools;
      const connectorQueriedStatePools = scratch.connectorQueriedStatePools ?? [];
      scratch.connectorQueriedStatePools = connectorQueriedStatePools;
      const wheelCenterProjections = connectorWheelCenterProjections(
        track,
        car,
        geometry.contactPatches,
        centerState,
        connectorProgressHint,
        connectorProjectionPools,
        connectorPositionPools,
      );
      const mainRoadEdge = track.width / 2 + (track.kerbWidth ?? 0);
      let allWheelCentersOnMainTrack = Array.isArray(wheelCenterProjections);
      for (let index = 0; allWheelCentersOnMainTrack && index < wheelCenterProjections.length; index += 1) {
        const projection = wheelCenterProjections[index];
        if (!projection || projection.crossTrackError > mainRoadEdge) allWheelCentersOnMainTrack = false;
      }
      if (allWheelCentersOnMainTrack) {
        connectorQueriedStatePools.length = 0;
        analyticSummary = writeAnalyticWheelStatesFromTrackStatesWithSummary(
          scratchWheels,
          geometry.contactPatches,
          wheelCenterProjections,
          track,
          trackLimit,
          scratchSummary,
        );
      } else {
        const wheelCenterStates = wheelCenterProjections
          ? writeLocalSegmentTrackStatesFromProjections(
            track,
            connectorPositionPools,
            connectorProgressHint,
            wheelCenterProjections,
            {
              allowPitOverride,
              skipPitOverrideInsideMainRoad: true,
              target: connectorQueriedStatePools,
            },
          )
          : connectorWheelCenterStates(
            track,
            car,
            geometry.contactPatches,
            centerState,
            connectorProgressHint,
            connectorQueriedStatePools,
            connectorProjectionPools,
            connectorPositionPools,
          );
        analyticSummary = writeConnectorWheelStatesWithSummary({
          targetWheels: scratchWheels,
          patches: geometry.contactPatches,
          wheelCenterStates,
          centerState,
          car,
          track,
          trackLimit,
          progressHint: connectorProgressHint,
          sampledStatePools,
          summaryTarget: scratchSummary,
        });
      }
    } else if (useFullSampling) {
      const sampledStatePools = scratch.sampledStatePools ?? [];
      scratch.sampledStatePools = sampledStatePools;
      analyticSummary = writeNearestSampledWheelStatesWithSummary({
        targetWheels: scratchWheels,
        patches: geometry.contactPatches,
        car,
        track,
        trackLimit,
        sampledStatePools,
        summaryTarget: scratchSummary,
      });
    } else {
      analyticSummary = writeAnalyticWheelStatesWithSummary(
        scratchWheels,
        geometry.contactPatches,
        centerState,
        track,
        trackLimit,
        scratchSummary,
      );
    }
  } else if (useAnalyticPitSampling) {
    recordScratchlessScalarWheelBatch(car, geometry.contactPatches.length);
    analyticSummary = writeAnalyticPitWheelStatesWithSummary(
      wheels,
      geometry.contactPatches,
      centerState,
      track,
      trackLimit,
    );
  } else if (connectorPitChecksSkipped || connectorStraightMainTrackAnalytic) {
    recordScratchlessScalarWheelBatch(car, geometry.contactPatches.length);
    analyticSummary = writeAnalyticWheelStatesWithSummary(
      wheels,
      geometry.contactPatches,
      centerState,
      track,
      trackLimit,
    );
  } else if (useConnectorSampling) {
    recordScratchlessScalarWheelBatch(car, geometry.contactPatches.length);
    const wheelCenterStates = connectorWheelCenterStates(track, car, geometry.contactPatches, centerState, connectorProgressHint);
    analyticSummary = writeConnectorWheelStatesWithSummary({
      targetWheels: wheels,
      patches: geometry.contactPatches,
      wheelCenterStates,
      centerState,
      car,
      track,
      trackLimit,
      progressHint: connectorProgressHint,
      sampledStatePools: new Array(geometry.contactPatches.length),
    });
  } else if (useFullSampling) {
    recordScratchlessScalarWheelBatch(car, geometry.contactPatches.length);
    analyticSummary = writeNearestSampledWheelStatesWithSummary({
      targetWheels: wheels,
      patches: geometry.contactPatches,
      car,
      track,
      trackLimit,
      sampledStatePools: new Array(geometry.contactPatches.length),
    });
  } else {
    recordScratchlessScalarWheelBatch(car, geometry.contactPatches.length);
    analyticSummary = writeAnalyticWheelStatesWithSummary(
      wheels,
      geometry.contactPatches,
      centerState,
      track,
      trackLimit,
    );
  }
  const summary = analyticSummary;
  const effectiveSurface = summary.effectiveSurface;
  const representative = summary.representative;
  const trackLimits = summary.trackLimits;

  return {
    wheels,
    effectiveSurface,
    trackLimits,
    sampleMode: useAnalyticPitSampling
      ? 'pit-analytic'
      : useConnectorSampling
        ? 'connector-analytic'
        : useFullSampling
          ? 'full'
          : 'analytic',
    representativeState: representative
      ? writeRepresentativeTrackState(
        trackStateTarget ?? {},
        centerState,
        effectiveSurface,
        representative,
        summary.allOnTrackOrPit,
        summary.allInPitLane,
      )
      : nearestTrackStateForCar(track, car),
  };
}

export function applyWheelSurfaceState(car, track, options = {}) {
  const geometry = getCurrentVehicleGeometryState(car);
  const allowPitOverride = options.allowPitOverride ?? pitOverrideAllowedForCar(car);
  const cached = car.wheelSurfaceCache;
  if (
    cached?.track === track &&
    cached.geometryX === (geometry.pose?.x ?? null) &&
    cached.geometryY === (geometry.pose?.y ?? null) &&
    cached.geometryHeading === (geometry.pose?.heading ?? null) &&
    cacheMatchesCenterState(cached, options.centerState, options.cacheAsAuto) &&
    cached.pitOverrideAllowed === allowPitOverride
  ) {
    car.wheelStates = cached.result.wheels;
    car.trackLimitState = cached.result.trackLimits;
    car.trackState = cached.trackState;
    return cached.result;
  }

  const result = calculateWheelSurfaceState({
    car,
    track,
    centerState: options.centerState,
    geometry,
    scratch: car.wheelSurfaceScratch ??= {},
    allowPitOverride,
    trackStateTarget: car.trackState ?? {},
  });
  car.wheelStates = result.wheels;
  car.trackLimitState = result.trackLimits;
  car.trackState = result.representativeState;
  car.trackStatePoseX = car.x;
  car.trackStatePoseY = car.y;
  car.trackStatePoseHeading = car.heading;
  const cache = cached ?? {};
  cache.track = track;
  cache.geometryX = geometry.pose?.x ?? null;
  cache.geometryY = geometry.pose?.y ?? null;
  cache.geometryHeading = geometry.pose?.heading ?? null;
  writeCachedCenterState(cache, options.centerState, options.cacheAsAuto);
  cache.pitOverrideAllowed = allowPitOverride;
  cache.result = result;
  cache.trackState = car.trackState;
  car.wheelSurfaceCache = cache;
  return result;
}
