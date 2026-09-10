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
  let rightOutside = true;
  let leftOutside = true;
  for (let index = 0; index < samples.length; index += 1) {
    const state = samples[index];
    if (state.inPitLane || state.signedOffset <= trackLimit) rightOutside = false;
    if (state.inPitLane || state.signedOffset >= -trackLimit) leftOutside = false;
  }
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

export function writeAnalyticWheelState(target, patch, centerState, track, trackLimit) {
  return writeAnalyticWheelStateWithProjectedHalfWidth(
    target,
    patch,
    centerState,
    track,
    trackLimit,
    analyticWheelProjectedHalfWidth(patch, centerState),
  );
}

export function analyticWheelProjectedHalfWidth(patch, centerState) {
  return (
    Math.abs(patch.forward.x * centerState.normalX + patch.forward.y * centerState.normalY) * patch.halfLength +
    Math.abs(patch.right.x * centerState.normalX + patch.right.y * centerState.normalY) * patch.halfWidth
  );
}

export function writeAnalyticWheelStateWithProjectedHalfWidth(
  target,
  patch,
  centerState,
  track,
  trackLimit,
  projectedHalfWidth,
) {
  const wheelCenterOffset =
    (patch.center.x - centerState.x) * centerState.normalX +
    (patch.center.y - centerState.y) * centerState.normalY;
  const minimumSignedOffset = wheelCenterOffset - projectedHalfWidth;
  const maximumSignedOffset = wheelCenterOffset + projectedHalfWidth;
  const signedOffset = Math.abs(minimumSignedOffset) > Math.abs(maximumSignedOffset)
    ? minimumSignedOffset
    : maximumSignedOffset;
  const outside = wheelOutsideFromOffsets(minimumSignedOffset, maximumSignedOffset, trackLimit);
  const sampledStates = target.sampledStates ?? [];
  const state = sampledStates.length === 1 ? (sampledStates[0] ?? {}) : {};
  sampledStates.length = 1;
  sampledStates[0] = state;
  writeStateFromSignedOffset(state, track, signedOffset);

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

function writeStateFromSignedOffset(target, track, signedOffset) {
  const crossTrackError = Math.abs(signedOffset);
  const surface = mainTrackSurface(track, crossTrackError);
  target.signedOffset = signedOffset;
  target.crossTrackError = crossTrackError;
  target.surface = surface;
  target.onTrack = surface === 'track' || surface === 'kerb';
  target.inPitLane = false;
  target.pitLanePart = null;
  target.pitBoxId = null;
  return target;
}
