import { clamp } from '../simMath.js';

// Keep steering's pursuit horizon and pace's braking reservation in the same
// geometry. The car must slow before steering starts building corner force.
export function advancedRacingLookaheadMeters(speedMps) {
  return clamp(12 + speedMps * 0.65, 12, 55);
}

export function advancedRacingYawResponseSeconds(profile) {
  return 0.18 + 0.12 * (1 - profile.ability);
}

export function advancedRacingPreviewReserveMeters(speedMps, profile, sampleSpacingMeters) {
  return advancedRacingLookaheadMeters(speedMps) + speedMps *
    (advancedRacingYawResponseSeconds(profile) + profile.anticipationSeconds) + sampleSpacingMeters;
}
