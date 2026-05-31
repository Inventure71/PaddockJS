export function mainTrackSurface(track, crossTrackError) {
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

export function wheelFullyOutside(samples, trackLimit) {
  const rightOutside = samples.every((state) => !state.inPitLane && state.signedOffset > trackLimit);
  const leftOutside = samples.every((state) => !state.inPitLane && state.signedOffset < -trackLimit);
  return {
    rightOutside,
    leftOutside,
    fullyOutsideWhiteLine: rightOutside || leftOutside,
    outsideSide: rightOutside ? 1 : leftOutside ? -1 : 0,
  };
}

export function wheelOutsideFromOffsets(minimumSignedOffset, maximumSignedOffset, trackLimit) {
  const rightOutside = minimumSignedOffset > trackLimit;
  const leftOutside = maximumSignedOffset < -trackLimit;
  return {
    rightOutside,
    leftOutside,
    fullyOutsideWhiteLine: rightOutside || leftOutside,
    outsideSide: rightOutside ? 1 : leftOutside ? -1 : 0,
  };
}

export function analyticWheelState(patch, centerState, track, trackLimit) {
  return writeAnalyticWheelState({}, patch, centerState, track, trackLimit);
}

export function writeAnalyticWheelState(target, patch, centerState, track, trackLimit) {
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
  const sampledStates = target.sampledStates ?? [];
  sampledStates.length = 1;
  sampledStates[0] = state;

  target.id = patch.id;
  target.x = patch.center.x;
  target.y = patch.center.y;
  target.signedOffset = state.signedOffset;
  target.crossTrackError = state.crossTrackError;
  target.surface = state.surface;
  target.onTrack = Boolean(state.onTrack);
  target.inPitLane = false;
  target.pitLanePart = null;
  target.pitBoxId = null;
  target.minimumSignedOffset = minimumSignedOffset;
  target.maximumSignedOffset = maximumSignedOffset;
  target.fullyOutsideWhiteLine = outside.fullyOutsideWhiteLine;
  target.outsideSide = outside.outsideSide;
  target.sampledStates = sampledStates;
  return target;
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
