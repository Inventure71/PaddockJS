import { normalizeAngle } from '../simulation/simMath.js';
import { pointAt } from '../simulation/track/trackModel.js';
import { simUnitsToMeters } from '../simulation/units.js';

const LEGAL_SURFACES = new Set(['track', 'kerb', 'pit-entry', 'pit-lane', 'pit-exit', 'pit-box']);
const ILLEGAL_SURFACES = new Set(['grass', 'gravel', 'runoff', 'barrier']);

export function buildDriverMetrics({ snapshot, previousSnapshot = null, options, events = [] }) {
  const previousById = new Map((previousSnapshot?.cars ?? []).map((car) => [car.id, car]));
  const currentById = new Map(snapshot.cars.map((car) => [car.id, car]));
  return Object.fromEntries(options.controlledDrivers.map((driverId) => {
    const car = currentById.get(driverId);
    const previous = previousById.get(driverId);
    return [driverId, car ? buildMetricForDriver(car, previous, snapshot, events) : emptyMetrics()];
  }));
}

function buildMetricForDriver(car, previous, snapshot, events) {
  const progressDeltaMeters = progressDelta(car, previous);
  const wheelSurfaces = Array.isArray(car.wheels) ? car.wheels.map((wheel) => wheel.surface) : [];
  const hasKerb = wheelSurfaces.includes('kerb') || car.surface === 'kerb';
  const fullyOutsideWhiteLine = wheelsFullyOutside(car.wheels);
  const offTrack = isOffTrack(car, wheelSurfaces, fullyOutsideWhiteLine);
  const severeCut = isSevereCut(car, wheelSurfaces, fullyOutsideWhiteLine);
  const completedLap = completedLaps(car) > completedLaps(previous);
  return {
    progressDeltaMeters,
    legalProgressDeltaMeters: offTrack || severeCut ? 0 : Math.max(0, progressDeltaMeters),
    offTrack,
    kerb: hasKerb,
    fullyOutsideWhiteLine,
    severeCut,
    under30kph: (car.speedKph ?? 0) < 30,
    spinOrBackwards: isSpinOrBackwards(car, snapshot),
    completedLap,
    lapTimeSeconds: completedLap ? lastLapTimeSeconds(car) : null,
    contactCount: countDriverContacts(car.id, events),
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

function isOffTrack(car, wheelSurfaces, fullyOutsideWhiteLine) {
  if (car.inPitLane) return false;
  if (fullyOutsideWhiteLine) return true;
  if (wheelSurfaces.length > 0) {
    return wheelSurfaces.some((surface) => !LEGAL_SURFACES.has(surface ?? 'track'));
  }
  return !LEGAL_SURFACES.has(car.surface ?? 'track');
}

function isSevereCut(car, wheelSurfaces, fullyOutsideWhiteLine) {
  if (car.inPitLane) return false;
  if (fullyOutsideWhiteLine) return true;
  if (wheelSurfaces.length > 0) {
    return wheelSurfaces.every((surface) => ILLEGAL_SURFACES.has(surface ?? 'track'));
  }
  return ILLEGAL_SURFACES.has(car.surface ?? 'track');
}

function wheelsFullyOutside(wheels = []) {
  if (!wheels.length) return false;
  return wheels.every((wheel) => wheel.fullyOutsideWhiteLine);
}

function isSpinOrBackwards(car, snapshot) {
  if (['spun', 'backwards'].includes(car.stabilityState)) return true;
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

function countDriverContacts(driverId, events) {
  return events.filter((event) => (
    ['collision', 'contact', 'car-contact'].includes(event.type) &&
    [event.driverId, event.carId, event.otherCarId, ...(event.driverIds ?? [])].includes(driverId)
  )).length;
}
