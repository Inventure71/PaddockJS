import { nearestTrackState } from './trackModel.js';
import { getVehicleGeometryState } from './vehicleGeometry.js';

const SURFACE_PRIORITY = {
  track: 0,
  'pit-entry': 1,
  'pit-exit': 1,
  'pit-lane': 2,
  'pit-box': 3,
  kerb: 4,
  grass: 5,
  gravel: 6,
  barrier: 7,
};
const PIT_CONNECTOR_FULL_SAMPLE_WINDOW = 420;

function priority(surface) {
  return SURFACE_PRIORITY[surface] ?? SURFACE_PRIORITY.barrier;
}

function worstState(states) {
  return states.reduce((worst, state) => (
    priority(state.surface) > priority(worst.surface) ? state : worst
  ), states[0]);
}

function patchSamples(patch) {
  return [patch.center, ...patch.corners];
}

function wrappedDistanceDelta(first, second, length) {
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(length) || length <= 0) return Infinity;
  const delta = Math.abs(first - second);
  return Math.min(delta, length - delta);
}

function isNearPitConnector(track, centerState) {
  const pitLane = track.pitLane;
  if (!pitLane?.enabled) return false;
  const distance = centerState.distance;
  const entryDistance = pitLane.entry?.trackDistance ?? pitLane.entry?.distanceFromStart;
  const exitDistance = pitLane.exit?.trackDistance ?? pitLane.exit?.distanceFromStart;
  return wrappedDistanceDelta(distance, entryDistance, track.length) <= PIT_CONNECTOR_FULL_SAMPLE_WINDOW ||
    wrappedDistanceDelta(distance, exitDistance, track.length) <= PIT_CONNECTOR_FULL_SAMPLE_WINDOW;
}

function mainTrackSurface(track, crossTrackError) {
  const trackEdge = track.width / 2;
  const kerbEdge = trackEdge + (track.kerbWidth ?? 0);
  const gravelEdge = kerbEdge + track.gravelWidth;
  const runoffEdge = gravelEdge + track.runoffWidth;
  if (crossTrackError <= trackEdge) return 'track';
  if (crossTrackError <= kerbEdge) return 'kerb';
  if (crossTrackError <= gravelEdge) return 'gravel';
  if (crossTrackError <= runoffEdge) return 'grass';
  return 'barrier';
}

function localTrackState(track, centerState, point) {
  const signedOffset =
    (point.x - centerState.x) * centerState.normalX +
    (point.y - centerState.y) * centerState.normalY;
  const crossTrackError = Math.abs(signedOffset);
  const surface = mainTrackSurface(track, crossTrackError);
  return {
    ...centerState,
    signedOffset,
    crossTrackError,
    surface,
    onTrack: surface === 'track' || surface === 'kerb',
    inPitLane: false,
    pitLanePart: null,
    pitBoxId: null,
  };
}

function wheelFullyOutside(samples, trackLimit) {
  const rightOutside = samples.every((state) => !state.inPitLane && state.signedOffset > trackLimit);
  const leftOutside = samples.every((state) => !state.inPitLane && state.signedOffset < -trackLimit);
  return {
    rightOutside,
    leftOutside,
    fullyOutsideWhiteLine: rightOutside || leftOutside,
    outsideSide: rightOutside ? 1 : leftOutside ? -1 : 0,
  };
}

function wheelOutsideFromOffsets(minimumSignedOffset, maximumSignedOffset, trackLimit) {
  const rightOutside = minimumSignedOffset > trackLimit;
  const leftOutside = maximumSignedOffset < -trackLimit;
  return {
    rightOutside,
    leftOutside,
    fullyOutsideWhiteLine: rightOutside || leftOutside,
    outsideSide: rightOutside ? 1 : leftOutside ? -1 : 0,
  };
}

function stateFromSignedOffset(centerState, track, signedOffset) {
  const crossTrackError = Math.abs(signedOffset);
  const surface = mainTrackSurface(track, crossTrackError);
  return {
    ...centerState,
    signedOffset,
    crossTrackError,
    surface,
    onTrack: surface === 'track' || surface === 'kerb',
    inPitLane: false,
    pitLanePart: null,
    pitBoxId: null,
  };
}

function analyticWheelState(patch, centerState, track, trackLimit) {
  const wheelCenterOffset =
    (patch.center.x - centerState.x) * centerState.normalX +
    (patch.center.y - centerState.y) * centerState.normalY;
  const projectedHalfWidth =
    Math.abs(patch.forward.x * centerState.normalX + patch.forward.y * centerState.normalY) * patch.halfLength +
    Math.abs(patch.right.x * centerState.normalX + patch.right.y * centerState.normalY) * patch.halfWidth;
  const minimumSignedOffset = wheelCenterOffset - projectedHalfWidth;
  const maximumSignedOffset = wheelCenterOffset + projectedHalfWidth;
  const signedOffset = Math.abs(minimumSignedOffset) > Math.abs(maximumSignedOffset)
    ? minimumSignedOffset
    : maximumSignedOffset;
  const state = stateFromSignedOffset(centerState, track, signedOffset);
  const outside = wheelOutsideFromOffsets(minimumSignedOffset, maximumSignedOffset, trackLimit);

  return {
    id: patch.id,
    x: patch.center.x,
    y: patch.center.y,
    signedOffset: state.signedOffset,
    crossTrackError: state.crossTrackError,
    surface: state.surface,
    onTrack: Boolean(state.onTrack),
    inPitLane: false,
    pitLanePart: null,
    pitBoxId: null,
    minimumSignedOffset,
    maximumSignedOffset,
    fullyOutsideWhiteLine: outside.fullyOutsideWhiteLine,
    outsideSide: outside.outsideSide,
    sampledStates: [state],
  };
}

export function getEffectiveSurface(wheels = []) {
  if (!wheels.length) return 'track';
  return wheels.reduce((surface, wheel) => (
    priority(wheel.surface) > priority(surface) ? wheel.surface : surface
  ), 'track');
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

export function calculateWheelSurfaceState({ car, track, centerState: providedCenterState = null }) {
  const geometry = getVehicleGeometryState(car);
  const trackLimit = track.width / 2;
  const centerState = providedCenterState ?? nearestTrackState(track, car, car.progress);
  const useFullSampling = Boolean(centerState.inPitLane || isNearPitConnector(track, centerState));
  const wheels = useFullSampling
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
    sampleMode: useFullSampling ? 'full' : 'analytic',
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
  const result = calculateWheelSurfaceState({ car, track, centerState: options.centerState });
  car.wheelStates = result.wheels;
  car.trackLimitState = result.trackLimits;
  car.trackState = {
    ...result.representativeState,
    wheelSurface: result.effectiveSurface,
  };
  return result;
}
