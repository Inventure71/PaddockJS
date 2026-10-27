import { ENVIRONMENT_SCENARIO_PRESETS } from './scenarioPresets.js';

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
