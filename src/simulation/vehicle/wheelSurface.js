import { nearestTrackState } from '../track/trackModel.js';
import { getVehicleGeometryState } from './vehicleGeometry.js';
import { analyticWheelState, wheelFullyOutside } from './mainTrackWheelSurface.js';
import { analyticPitWheelState, canUseAnalyticPitWheels, isNearPitConnector, patchSamples } from './pitWheelSurface.js';
import { getEffectiveSurface, worstState } from './surfacePriority.js';

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

export function calculateWheelSurfaceState({ car, track, centerState: providedCenterState = null }) {
  const geometry = getVehicleGeometryState(car);
  const trackLimit = track.width / 2;
  const centerState = providedCenterState ?? nearestTrackState(track, car, car.progress);
  const useAnalyticPitSampling = canUseAnalyticPitWheels(geometry, centerState);
  const useFullSampling = !useAnalyticPitSampling && Boolean(centerState.inPitLane || isNearPitConnector(track, centerState));
  const wheels = useAnalyticPitSampling
    ? geometry.contactPatches.map((patch) => analyticPitWheelState(patch, centerState))
    : useFullSampling
    ? geometry.contactPatches.map((patch) => {
        const sampleState = (point) => nearestTrackState(track, point, car.progress);
        const sampledStates = patchSamples(patch).map(sampleState);
        const state = worstState(sampledStates);
        const offsets = sampledStates.map((sample) => sample.signedOffset);
        const outside = wheelFullyOutside(sampledStates, trackLimit);

        return {
          id: patch.id,
          x: patch.center.x,
          y: patch.center.y,
          signedOffset: state.signedOffset,
          crossTrackError: state.crossTrackError,
          surface: state.surface,
          onTrack: Boolean(state.onTrack),
          inPitLane: Boolean(state.inPitLane),
          pitLanePart: state.pitLanePart ?? null,
          pitBoxId: state.pitBoxId ?? null,
          minimumSignedOffset: Math.min(...offsets),
          maximumSignedOffset: Math.max(...offsets),
          fullyOutsideWhiteLine: outside.fullyOutsideWhiteLine,
          outsideSide: outside.outsideSide,
          sampledStates,
        };
      })
    : geometry.contactPatches.map((patch) => analyticWheelState(patch, centerState, track, trackLimit));
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
    } : nearestTrackState(track, car, car.progress),
  };
}

export function applyWheelSurfaceState(car, track, options = {}) {
  const geometry = getVehicleGeometryState(car);
  const cacheKey = {
    track,
    geometrySignature: geometry.signature,
    centerSignature: centerStateSignature(options.centerState),
  };
  const cached = car.wheelSurfaceCache;
  if (
    cached?.track === cacheKey.track &&
    cached.geometrySignature === cacheKey.geometrySignature &&
    cached.centerSignature === cacheKey.centerSignature
  ) {
    car.wheelStates = cached.result.wheels;
    car.trackLimitState = cached.result.trackLimits;
    car.trackState = cached.trackState;
    return cached.result;
  }

  const result = calculateWheelSurfaceState({ car, track, centerState: options.centerState });
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
