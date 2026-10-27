import { metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';

export const ENVIRONMENT_SCENARIO_PRESETS = Object.freeze([
  'cornering',
  'off-track-recovery',
  'overtaking-pack',
  'pit-entry',
]);

export function buildPresetPlacements(snapshot, options) {
  const preset = options.scenario?.preset;
  if (!preset) return {};
  const controlledDriverId = options.controlledDrivers[0];
  const cars = snapshot.cars;
  const track = snapshot.track;
  const primaryDistance = presetBaseDistance(track, preset);
  const placements = {};

  if (preset === 'cornering') {
    placements[controlledDriverId] = {
      distanceMeters: simUnitsToMeters(primaryDistance),
      offsetMeters: 0,
      speedKph: 135,
      headingErrorRadians: 0,
    };
  } else if (preset === 'off-track-recovery') {
    placements[controlledDriverId] = {
      distanceMeters: simUnitsToMeters(primaryDistance),
      offsetMeters: simUnitsToMeters(track.width / 2) + 7,
      speedKph: 52,
      headingErrorRadians: -0.45,
    };
  } else if (preset === 'pit-entry') {
    placements[controlledDriverId] = {
      distanceMeters: simUnitsToMeters(primaryDistance),
      offsetMeters: 0,
      speedKph: 120,
      headingErrorRadians: 0,
    };
  } else if (preset === 'overtaking-pack') {
    const baseMeters = simUnitsToMeters(primaryDistance);
    cars.slice(0, 4).forEach((car, index) => {
      placements[car.id] = {
        distanceMeters: baseMeters + (index - 1) * 18,
        offsetMeters: index % 2 === 0 ? -2.2 : 2.2,
        speedKph: 135 - index * 3,
        headingErrorRadians: 0,
      };
    });
  }

  return placements;
}

function presetBaseDistance(track, preset) {
  if (preset === 'cornering') return findHighCurvatureDistance(track) - metersToSimUnits(70);
  if (preset === 'off-track-recovery') return track.length * 0.42;
  if (preset === 'overtaking-pack') return track.length * 0.35;
  if (preset === 'pit-entry') {
    const pitDistance = track.pitLane?.entry?.trackDistance ??
      track.pitLane?.entry?.distanceFromStart ??
      track.length * 0.92;
    return pitDistance - metersToSimUnits(170);
  }
  return 0;
}

function findHighCurvatureDistance(track) {
  const samples = Array.isArray(track.samples) ? track.samples : [];
  const fallback = track.length * 0.25;
  const best = samples
    .filter((sample) => sample.distance > metersToSimUnits(350))
    .reduce((selected, sample) => {
      if (!selected || (sample.curvature ?? 0) > (selected.curvature ?? 0)) return sample;
      return selected;
    }, null);
  return best?.distance ?? fallback;
}
