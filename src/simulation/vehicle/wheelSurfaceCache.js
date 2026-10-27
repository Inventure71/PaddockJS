// Pose and explicit-center validity for the per-car wheel-surface cache.

function usesAutomaticCenterState(centerState, cacheAsAuto = false) {
  return cacheAsAuto || centerState == null;
}

export function cacheMatchesCenterState(cache, centerState, cacheAsAuto = false) {
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

export function writeCachedCenterState(cache, centerState, cacheAsAuto = false) {
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

export function canRefreshAutomaticCenterStateFromTrackState(car, track) {
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
