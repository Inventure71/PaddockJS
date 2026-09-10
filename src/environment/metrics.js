import { writeEventDriverIds } from './events.js';
import { normalizeAngle } from '../simulation/simMath.js';
import { pointAt } from '../simulation/track/trackModel.js';
import { simUnitsToMeters } from '../simulation/units.js';

const LEGAL_SURFACES = new Set(['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit', 'pit-box']);
const ILLEGAL_SURFACES = new Set(['grass', 'gravel', 'runoff', 'barrier']);
const UNSTABLE_STATES = new Set(['spun', 'backwards', 'spin-risk', 'understeer', 'oversteer', 'destroyed']);
export const ENVIRONMENT_METRIC_FIELDS = Object.freeze([
  'progressDeltaMeters',
  'legalProgressDeltaMeters',
  'offTrack',
  'kerb',
  'fullyOutsideWhiteLine',
  'severeCut',
  'destroyed',
  'destroyReason',
  'under30kph',
  'spinOrBackwards',
  'completedLap',
  'lapTimeSeconds',
  'contactCount',
]);

export function isEnvironmentCarOffTrack(car) {
  if (!car) return false;
  return isOffTrack(car, classifyWheels(car));
}

export function isEnvironmentContactEvent(event) {
  return ['collision', 'contact', 'car-contact'].includes(event?.type);
}

export function buildDriverMetrics({ snapshot, previousSnapshot = null, options, events = [], scratch = null }) {
  const previousById = carsByIdForMetrics(previousSnapshot, scratch, 'previousCarsById');
  const currentById = carsByIdForMetrics(snapshot, scratch, 'currentCarsById');
  const contactCounts = contactCountsByDriver(events, scratch);
  const metrics = {};
  options.controlledDrivers.forEach((driverId) => {
    const car = currentById.get(driverId);
    const previous = previousById.get(driverId);
    metrics[driverId] = car ? buildMetricForDriver(car, previous, snapshot, contactCounts?.get(driverId) ?? 0) : emptyMetrics();
  });
  return metrics;
}

function carsByIdForMetrics(snapshot, scratch, key) {
  if (!scratch) return new Map((snapshot?.cars ?? []).map((car) => [car.id, car]));
  const carsById = scratch[key] ?? new Map();
  scratch[key] = carsById;
  carsById.clear();
  const cars = snapshot?.cars ?? [];
  for (let index = 0; index < cars.length; index += 1) {
    const car = cars[index];
    carsById.set(car.id, car);
  }
  return carsById;
}

function buildMetricForDriver(car, previous, snapshot, contactCount) {
  const progressDeltaMeters = progressDelta(car, previous);
  const wheelState = classifyWheels(car);
  const offTrack = isOffTrack(car, wheelState);
  const severeCut = isSevereCut(car, wheelState);
  const completedLap = completedLaps(car) > completedLaps(previous);
  const destroyed = Boolean(car.destroyed);
  return {
    progressDeltaMeters,
    legalProgressDeltaMeters: destroyed || offTrack || severeCut ? 0 : Math.max(0, progressDeltaMeters),
    offTrack,
    kerb: wheelState.hasKerb,
    fullyOutsideWhiteLine: wheelState.fullyOutsideWhiteLine,
    severeCut,
    destroyed,
    destroyReason: car.destroyReason ?? null,
    under30kph: (car.speedKph ?? 0) < 30,
    spinOrBackwards: isSpinOrBackwards(car, snapshot),
    completedLap,
    lapTimeSeconds: completedLap ? lastLapTimeSeconds(car) : null,
    contactCount,
  };
}

function emptyMetrics() {
  return {
    progressDeltaMeters: 0,
    legalProgressDeltaMeters: 0,
    offTrack: true,
    kerb: false,
    fullyOutsideWhiteLine: true,
    severeCut: true,
    destroyed: true,
    destroyReason: 'missing-car',
    under30kph: true,
    spinOrBackwards: false,
    completedLap: false,
    lapTimeSeconds: null,
    contactCount: 0,
  };
}

function progressDelta(car, previous) {
  if (!previous) return 0;
  if (Number.isFinite(car.distanceMeters) && Number.isFinite(previous.distanceMeters)) {
    return car.distanceMeters - previous.distanceMeters;
  }
  return simUnitsToMeters((car.raceDistance ?? car.progress ?? 0) - (previous.raceDistance ?? previous.progress ?? 0));
}

function isOffTrack(car, wheelState) {
  if (car.inPitLane) return false;
  if (wheelState.fullyOutsideWhiteLine) return true;
  if (wheelState.hasWheels) return wheelState.hasIllegalSurface;
  return !LEGAL_SURFACES.has(car.surface ?? 'track');
}

function isSevereCut(car, wheelState) {
  if (car.inPitLane) return false;
  if (wheelState.fullyOutsideWhiteLine) return true;
  if (wheelState.hasWheels) return wheelState.allIllegalSurface;
  return ILLEGAL_SURFACES.has(car.surface ?? 'track');
}

function classifyWheels(car) {
  const wheels = Array.isArray(car.wheels) ? car.wheels : [];
  if (!wheels.length) {
    return {
      hasWheels: false,
      hasKerb: car.surface === 'kerb',
      fullyOutsideWhiteLine: false,
      hasIllegalSurface: false,
      allIllegalSurface: false,
    };
  }
  let hasKerb = car.surface === 'kerb';
  let fullyOutsideWhiteLine = true;
  let hasIllegalSurface = false;
  let allIllegalSurface = true;
  wheels.forEach((wheel) => {
    const surface = wheel.surface ?? 'track';
    if (surface === 'kerb') hasKerb = true;
    if (!wheel.fullyOutsideWhiteLine) fullyOutsideWhiteLine = false;
    if (!LEGAL_SURFACES.has(surface)) hasIllegalSurface = true;
    if (!ILLEGAL_SURFACES.has(surface)) allIllegalSurface = false;
  });
  return {
    hasWheels: true,
    hasKerb,
    fullyOutsideWhiteLine,
    hasIllegalSurface,
    allIllegalSurface,
  };
}

function isSpinOrBackwards(car, snapshot) {
  if (UNSTABLE_STATES.has(car.stabilityState)) return true;
  const trackHeading = car.trackState?.heading ?? pointAt(snapshot.track, car.progress ?? 0).heading;
  const headingError = Number.isFinite(car.trackHeadingError)
    ? car.trackHeadingError
    : normalizeAngle((car.heading ?? trackHeading) - trackHeading);
  return Math.abs(headingError) > Math.PI * 0.45;
}

function completedLaps(car) {
  return car?.lapTelemetry?.completedLaps ?? 0;
}

function lastLapTimeSeconds(car) {
  return car.lapTelemetry?.lastLapTime ?? car.lapTelemetry?.bestLapTime ?? null;
}

function contactCountsByDriver(events, scratch = null) {
  if (!events.length) return null;
  const counts = scratch ? (scratch.contactCounts ?? new Map()) : new Map();
  const eventDriverIds = scratch ? (scratch.eventDriverIds ?? []) : [];
  if (scratch) {
    scratch.contactCounts = counts;
    scratch.eventDriverIds = eventDriverIds;
  }
  counts.clear();
  events.forEach((event) => {
    if (!isEnvironmentContactEvent(event)) return;
    writeEventDriverIds(eventDriverIds, event);
    for (let index = 0; index < eventDriverIds.length; index += 1) {
      const driverId = eventDriverIds[index];
      counts.set(driverId, (counts.get(driverId) ?? 0) + 1);
    }
  });
  eventDriverIds.length = 0;
  return counts;
}
