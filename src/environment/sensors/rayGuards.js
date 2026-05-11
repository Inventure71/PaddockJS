export function canUseLocalStripRayApproximation(track, state) {
  if (!track || !state || state.inPitLane) return false;
  const kerbOuter = track.width / 2 + (track.kerbWidth ?? 0);
  return Number.isFinite(state.crossTrackError) && state.crossTrackError <= kerbOuter;
}
