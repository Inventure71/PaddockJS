import { getVehicleGeometryState } from './vehicleGeometry.js';
import { analyticWheelState, wheelFullyOutside, writeAnalyticWheelState } from './mainTrackWheelSurface.js';
import { analyticPitWheelState, canUseAnalyticPitWheels, isNearPitConnector, patchSamples, writeAnalyticPitWheelState } from './pitWheelSurface.js';
import { getEffectiveSurface, worstState } from './surfacePriority.js';
import { nearestTrackStateForCar, pitOverrideAllowedForCar } from '../track/trackStatePolicy.js';

function finiteSignatureValue(value) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : '';
}

function centerStateSignature(centerState) {
  if (!centerState) return 'auto';
  return [
    finiteSignatureValue(centerState.distance),
    finiteSignatureValue(centerState.signedOffset),
    finiteSignatureValue(centerState.crossTrackError),
    centerState.surface ?? '',
    centerState.inPitLane ? 1 : 0,
    centerState.pitLanePart ?? '',
    centerState.pitBoxId ?? '',
  ].join(':');
}

export { getEffectiveSurface } from './surfacePriority.js';

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

function sampleFullPatchInto(sampledStates, patch, sampleState) {
  sampledStates.length = 1 + patch.corners.length;
  sampledStates[0] = sampleState(patch.center);
  for (let index = 0; index < patch.corners.length; index += 1) {
    sampledStates[index + 1] = sampleState(patch.corners[index]);
  }
  return sampledStates;
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
  const right = wheels.every((wheel) => wheel.outsideSide === 1);
  const left = wheels.every((wheel) => wheel.outsideSide === -1);
  if (!right && !left) {
    return {
      violating: false,
      side: 0,
      outsideBy: 0,
    };
  }
  const side = right ? 1 : -1;
  const outsideBy = right
    ? Math.min(...wheels.map((wheel) => wheel.minimumSignedOffset)) - trackLimit
    : -trackLimit - Math.max(...wheels.map((wheel) => wheel.maximumSignedOffset));

  return {
    violating: outsideBy > 0,
    side,
    outsideBy: Math.max(0, outsideBy),
  };
}

export function calculateWheelSurfaceState({ car, track, centerState: providedCenterState = null, scratch = null }) {
  const geometry = getVehicleGeometryState(car);
  const trackLimit = track.width / 2;
  const allowPitOverride = pitOverrideAllowedForCar(car);
  const centerState = providedCenterState == null
    ? nearestTrackStateForCar(track, car)
    : !allowPitOverride && providedCenterState.inPitLane
      ? nearestTrackStateForCar(track, car, car, car.progress, { allowPitOverride: false })
      : providedCenterState;
  const useAnalyticPitSampling = canUseAnalyticPitWheels(geometry, centerState);
  const useFullSampling = !useAnalyticPitSampling && Boolean(centerState.inPitLane || isNearPitConnector(track, centerState));
  const scratchWheels = prepareScratchWheels(scratch, geometry.contactPatches.length);
  const wheels = scratchWheels ?? (useAnalyticPitSampling
    ? geometry.contactPatches.map((patch) => analyticPitWheelState(patch, centerState))
    : useFullSampling
      ? geometry.contactPatches.map((patch) => {
          const sampleState = (point) => nearestTrackStateForCar(track, car, point, car.progress);
          const sampledStates = patchSamples(patch).map(sampleState);
          return writeFullWheelState({}, patch, sampledStates, trackLimit);
        })
      : geometry.contactPatches.map((patch) => analyticWheelState(patch, centerState, track, trackLimit)));
  if (scratchWheels) {
    if (useAnalyticPitSampling) {
      geometry.contactPatches.forEach((patch, index) => {
        writeAnalyticPitWheelState(scratchWheels[index], patch, centerState);
      });
    } else if (useFullSampling) {
      const sampledStatePools = scratch.sampledStatePools ?? [];
      scratch.sampledStatePools = sampledStatePools;
      const sampleState = (point) => nearestTrackStateForCar(track, car, point, car.progress);
      geometry.contactPatches.forEach((patch, index) => {
        const sampledStates = sampledStatePools[index] ?? [];
        sampledStatePools[index] = sampledStates;
        sampleFullPatchInto(sampledStates, patch, sampleState);
        writeFullWheelState(scratchWheels[index], patch, sampledStates, trackLimit);
      });
    } else {
      geometry.contactPatches.forEach((patch, index) => {
        writeAnalyticWheelState(scratchWheels[index], patch, centerState, track, trackLimit);
      });
    }
  }
  const effectiveSurface = getEffectiveSurface(wheels);
  const representative = wheels.reduce((best, wheel) => (
    Math.abs(wheel.signedOffset) > Math.abs(best.signedOffset) ? wheel : best
  ), wheels[0]);
  const trackLimits = isWholeCarOutsideTrackLimits(wheels, track);

  return {
    wheels,
    effectiveSurface,
    trackLimits,
    sampleMode: useAnalyticPitSampling ? 'pit-analytic' : useFullSampling ? 'full' : 'analytic',
    representativeState: representative ? {
      ...centerState,
      surface: effectiveSurface,
      onTrack: wheels.every((wheel) => wheel.onTrack || wheel.inPitLane),
      inPitLane: wheels.every((wheel) => wheel.inPitLane),
      signedOffset: representative.signedOffset,
      crossTrackError: representative.crossTrackError,
    } : nearestTrackStateForCar(track, car),
  };
}

export function applyWheelSurfaceState(car, track, options = {}) {
  const geometry = getVehicleGeometryState(car);
  const cacheKey = {
    track,
    geometrySignature: geometry.signature,
    centerSignature: centerStateSignature(options.centerState),
    pitOverrideAllowed: pitOverrideAllowedForCar(car),
  };
  const cached = car.wheelSurfaceCache;
  if (
    cached?.track === cacheKey.track &&
    cached.geometrySignature === cacheKey.geometrySignature &&
    cached.centerSignature === cacheKey.centerSignature &&
    cached.pitOverrideAllowed === cacheKey.pitOverrideAllowed
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
    scratch: car.wheelSurfaceScratch ??= {},
  });
  car.wheelStates = result.wheels;
  car.trackLimitState = result.trackLimits;
  car.trackState = {
    ...result.representativeState,
    wheelSurface: result.effectiveSurface,
  };
  car.wheelSurfaceCache = {
    ...cacheKey,
    result,
    trackState: car.trackState,
  };
  return result;
}
