import { getCurrentVehicleGeometryState } from './vehicleGeometry.js';
import { analyticWheelProjectedHalfWidth, writeAnalyticWheelState, writeAnalyticWheelStateWithProjectedHalfWidth } from './mainTrackWheelSurface.js';
import { canUseAnalyticPitWheels, canSkipConnectorPitChecks, isNearPitConnector, writeAnalyticPitWheelState } from './pitWheelSurface.js';
import { cacheMatchesCenterState, writeCachedCenterState, canRefreshAutomaticCenterStateFromTrackState } from './wheelSurfaceCache.js';
import { resetWheelSummary, prepareWheelSummary, recordWheelSummary, finishWheelSummary } from './wheelSurfaceSummary.js';
import {
  connectorWheelCenterStates,
  connectorWheelCenterProjections,
  canUseStraightConnectorMainTrackAnalytic,
  writeConnectorWheelStatesWithSummary,
  writeNearestSampledWheelStatesWithSummary,
} from './sampledWheelSurface.js';
import { nearestTrackStateForCar, pitOverrideAllowedForCar, writeLocalSegmentTrackStatesFromProjections } from '../track/trackStatePolicy.js';

export { getEffectiveSurface } from './surfacePriority.js';
export { isWholeCarOutsideTrackLimits } from './wheelSurfaceSummary.js';

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
