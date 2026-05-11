import { normalizeAngle } from '../simulation/simMath.js';
import { offsetTrackPoint, pointAt } from '../simulation/track/trackModel.js';
import { kphToSimSpeed, metersToSimUnits, simUnitsToMeters } from '../simulation/units.js';

export const ENVIRONMENT_SCENARIO_PRESETS = Object.freeze([
  'cornering',
  'off-track-recovery',
  'overtaking-pack',
  'pit-entry',
]);

export function resolveScenarioPlacementConfig(scenario = {}, driverIds = new Set()) {
  const preset = scenario.preset == null ? null : String(scenario.preset);
  if (preset && !ENVIRONMENT_SCENARIO_PRESETS.includes(preset)) {
    throw new Error(`PaddockJS environment scenario.preset must be one of: ${ENVIRONMENT_SCENARIO_PRESETS.join(', ')}.`);
  }

  const placements = normalizePlacementMap(scenario.placements, driverIds);
  const traffic = normalizeTrafficLayout(scenario.traffic, driverIds);

  return {
    preset,
    placements,
    traffic,
  };
}

export function applyEnvironmentScenario(sim, options) {
  const scenario = options.scenario ?? {};
  if (!scenario.preset && Object.keys(scenario.placements ?? {}).length === 0 && (scenario.traffic ?? []).length === 0) {
    return;
  }

  const snapshot = sim.snapshot();
  const carsById = new Map(snapshot.cars.map((car) => [car.id, car]));
  const placements = {
    ...buildPresetPlacements(snapshot, options),
    ...(scenario.placements ?? {}),
  };

  applyEnvironmentPlacements(sim, snapshot.track, carsById, placements);

  const nextSnapshot = sim.snapshot();
  const nextCarsById = new Map(nextSnapshot.cars.map((car) => [car.id, car]));
  scenario.traffic?.forEach((trafficPlacement) => {
    const reference = nextCarsById.get(trafficPlacement.relativeTo);
    const car = nextCarsById.get(trafficPlacement.driverId);
    if (!reference || !car) return;
    applyEnvironmentPlacements(sim, nextSnapshot.track, nextCarsById, {
      [trafficPlacement.driverId]: {
      distanceMeters: reference.distanceMeters + trafficPlacement.deltaDistanceMeters,
      offsetMeters: trafficPlacement.offsetMeters,
      speedKph: trafficPlacement.speedKph ?? reference.speedKph,
      headingErrorRadians: trafficPlacement.headingErrorRadians ?? 0,
      },
    });
  });
}

export function normalizeEnvironmentPlacements(placements = {}, driverIds = new Set()) {
  return normalizePlacementMap(placements, driverIds);
}

function normalizePlacementMap(value, driverIds) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PaddockJS environment scenario.placements must be an object keyed by driver id.');
  }
  return Object.fromEntries(Object.entries(value).map(([driverId, placement]) => {
    assertKnownDriver(driverId, driverIds, 'scenario placement');
    return [driverId, normalizePlacement(placement, `scenario.placements.${driverId}`)];
  }));
}

function normalizeTrafficLayout(value, driverIds) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error('PaddockJS environment scenario.traffic must be an array.');
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`PaddockJS environment scenario.traffic[${index}] must be an object.`);
    }
    assertKnownDriver(entry.driverId, driverIds, `scenario.traffic[${index}].driverId`);
    assertKnownDriver(entry.relativeTo, driverIds, `scenario.traffic[${index}].relativeTo`);
    return {
      driverId: entry.driverId,
      relativeTo: entry.relativeTo,
      deltaDistanceMeters: finiteNumber(entry.deltaDistanceMeters, 0, `scenario.traffic[${index}].deltaDistanceMeters`),
      offsetMeters: finiteNumber(entry.offsetMeters, 0, `scenario.traffic[${index}].offsetMeters`),
      speedKph: optionalFiniteNumber(entry.speedKph, `scenario.traffic[${index}].speedKph`),
      headingErrorRadians: finiteNumber(entry.headingErrorRadians, 0, `scenario.traffic[${index}].headingErrorRadians`),
    };
  });
}

function normalizePlacement(placement, label) {
  if (!placement || typeof placement !== 'object') {
    throw new Error(`PaddockJS environment ${label} must be an object.`);
  }
  const distanceMeters = placement.distanceMeters ?? placement.startDistanceMeters;
  return {
    distanceMeters: optionalFiniteNumber(distanceMeters, `${label}.distanceMeters`),
    offsetMeters: finiteNumber(placement.offsetMeters, 0, `${label}.offsetMeters`),
    speedKph: optionalFiniteNumber(placement.speedKph, `${label}.speedKph`),
    headingErrorRadians: finiteNumber(placement.headingErrorRadians, 0, `${label}.headingErrorRadians`),
  };
}

function buildPresetPlacements(snapshot, options) {
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

export function applyEnvironmentPlacements(sim, track, carsById, placements = {}) {
  const states = {};
  Object.entries(placements).forEach(([driverId, placement]) => {
    const currentCar = carsById.get(driverId);
    if (!currentCar) return;
    states[driverId] = placementToCarState(track, currentCar, placement);
  });
  if (typeof sim.setCarStates === 'function') {
    sim.setCarStates(states);
    return;
  }
  Object.entries(states).forEach(([driverId, partial]) => {
    sim.setCarState(driverId, partial);
  });
}

function placementToCarState(track, currentCar, placement) {
  const currentDistanceMeters = currentCar.distanceMeters ?? simUnitsToMeters(currentCar.raceDistance ?? currentCar.progress ?? 0);
  const raceDistance = metersToSimUnits(Math.max(0, placement.distanceMeters ?? currentDistanceMeters));
  const offset = metersToSimUnits(placement.offsetMeters ?? 0);
  const base = pointAt(track, raceDistance);
  const position = offsetTrackPoint(base, offset);
  const heading = normalizeAngle(base.heading + (placement.headingErrorRadians ?? 0));
  const partial = {
    x: position.x,
    y: position.y,
    previousX: position.x,
    previousY: position.y,
    progress: base.distance,
    raceDistance,
    desiredOffset: offset,
    heading,
    previousHeading: heading,
  };
  if (placement.speedKph != null) partial.speed = kphToSimSpeed(placement.speedKph);
  return partial;
}

function assertKnownDriver(driverId, driverIds, label) {
  if (typeof driverId !== 'string' || driverId.length === 0) {
    throw new Error(`PaddockJS environment ${label} must be a driver id.`);
  }
  if (!driverIds.has(driverId)) {
    throw new Error(`PaddockJS environment ${label} does not exist: ${driverId}`);
  }
}

function finiteNumber(value, fallback, label) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`PaddockJS environment ${label} must be a finite number.`);
  }
  return number;
}

function optionalFiniteNumber(value, label) {
  if (value == null) return undefined;
  return finiteNumber(value, undefined, label);
}
