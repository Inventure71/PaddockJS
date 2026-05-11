import { simUnitsToMeters } from '../../simulation/units.js';

const SURFACE_CODES = {
  track: 0,
  kerb: 1,
  'pit-entry': 2,
  'pit-lane': 2,
  'pit-exit': 2,
  'pit-box': 2,
  grass: 3,
  gravel: 4,
  barrier: 5,
};

export const CONTACT_PATCH_IDS = Object.freeze(['front-left', 'front-right', 'rear-left', 'rear-right']);

export function buildContactPatchSenses(car) {
  const wheelsById = new Map((car.wheels ?? []).map((wheel) => [wheel.id, wheel]));
  return CONTACT_PATCH_IDS.map((id) => {
    const wheel = wheelsById.get(id);
    return {
      id,
      present: Boolean(wheel),
      signedOffsetMeters: simUnitsToMeters(wheel?.signedOffset ?? 0),
      crossTrackErrorMeters: simUnitsToMeters(wheel?.crossTrackError ?? 0),
      surface: wheel?.surface ?? 'track',
      surfaceCode: SURFACE_CODES[wheel?.surface ?? 'track'] ?? SURFACE_CODES.barrier,
      onLegalSurface: Boolean(wheel?.onTrack || wheel?.inPitLane),
      inPitLane: Boolean(wheel?.inPitLane),
    };
  });
}
