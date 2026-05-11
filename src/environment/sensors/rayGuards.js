import { metersToSimUnits } from '../../simulation/units.js';

export function canUseLocalStripRayApproximation(track, state) {
  if (!track || !state || state.inPitLane) return false;
  const kerbOuter = track.width / 2 + (track.kerbWidth ?? 0);
  return Number.isFinite(state.crossTrackError) && state.crossTrackError <= kerbOuter;
}

export function canUseIndexedRecoveryRayApproximation(track, state) {
  if (!track || !state || state.inPitLane) return false;
  const recoveryBand = track.width / 2 +
    (track.kerbWidth ?? 0) +
    (track.gravelWidth ?? 0) +
    (track.runoffWidth ?? 0) +
    metersToSimUnits(64);
  return Number.isFinite(state.crossTrackError) && state.crossTrackError <= recoveryBand;
}

export const canUseBatchTrainingRayApproximation = canUseIndexedRecoveryRayApproximation;
