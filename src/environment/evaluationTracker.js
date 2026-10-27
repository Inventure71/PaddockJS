import { simUnitsToMeters } from '../simulation/units.js';
import { isEnvironmentCarOffTrack } from './metrics.js';
import { isEnvironmentContactEvent, writeEventDriverIds } from './events.js';

export function createEvaluationTracker(initialResult, { lapScope = 'since-start' } = {}) {
  if (!initialResult?.state?.snapshot) {
    throw new Error('PaddockJS environment evaluation tracker requires result.state.snapshot; use result.stateOutput "minimal" or "full".');
  }
  const initialCars = carsById(initialResult.state.snapshot);
  const metrics = Object.fromEntries(initialResult.info.controlledDrivers.map((driverId) => {
    const car = initialCars.get(driverId);
    const offTrack = isEnvironmentCarOffTrack(car);
    return [driverId, {
      distanceMeters: 0,
      lapProgressMeters: lapProgressMetersFromSnapshotCar(car),
      offTrackSteps: offTrack ? 1 : 0,
      contactCount: 0,
      recoverySuccess: false,
      passCount: 0,
      lapTimeSeconds: lapScope === 'include-history' && completedLaps(car) > 0 ? recordedLapTime(car) : null,
      previousCompletedLaps: completedLaps(car),
      startedOffTrack: offTrack,
      startPosition: car?.rank ?? null,
      bestPosition: car?.rank ?? null,
      startDistanceMeters: cumulativeDistanceMetersFromSnapshotCar(car),
    }];
  }));

  return {
    update(result) {
      const currentCars = carsById(result.state.snapshot);
      result.info.controlledDrivers.forEach((driverId) => {
        const car = currentCars.get(driverId);
        const entry = metrics[driverId];
        if (!car || !entry) return;
        entry.distanceMeters = Math.max(0, cumulativeDistanceMetersFromSnapshotCar(car) - entry.startDistanceMeters);
        entry.lapProgressMeters = lapProgressMetersFromSnapshotCar(car);
        const offTrack = isEnvironmentCarOffTrack(car);
        if (offTrack) entry.offTrackSteps += 1;
        if (entry.startedOffTrack && !offTrack) entry.recoverySuccess = true;
        if (Number.isFinite(car.rank)) {
          entry.bestPosition = entry.bestPosition == null ? car.rank : Math.min(entry.bestPosition, car.rank);
          entry.passCount = entry.startPosition == null ? 0 : Math.max(0, entry.startPosition - entry.bestPosition);
        }
        const currentCompletedLaps = completedLaps(car);
        const newCompletion = currentCompletedLaps > entry.previousCompletedLaps;
        if (newCompletion && entry.lapTimeSeconds == null) {
          entry.lapTimeSeconds = recordedLapTime(car);
        }
        entry.previousCompletedLaps = currentCompletedLaps;
      });
      const eventDriverIds = [];
      result.events.forEach((event) => {
        if (!isEnvironmentContactEvent(event)) return;
        writeEventDriverIds(eventDriverIds, event).forEach((driverId) => {
          if (metrics[driverId]) metrics[driverId].contactCount += 1;
        });
      });
    },
    finish() {
      return Object.fromEntries(Object.entries(metrics).map(([driverId, entry]) => [
        driverId,
        {
          distanceMeters: entry.distanceMeters,
          lapProgressMeters: entry.lapProgressMeters,
          offTrackSteps: entry.offTrackSteps,
          contactCount: entry.contactCount,
          recoverySuccess: entry.recoverySuccess,
          passCount: entry.passCount,
          lapTimeSeconds: entry.lapTimeSeconds,
        },
      ]));
    },
  };
}

function cumulativeDistanceMetersFromSnapshotCar(car) {
  const distance = Number(car?.distanceMeters ?? car?.raceDistanceMeters);
  if (Number.isFinite(distance)) return distance;
  return simUnitsToMeters(car?.raceDistance ?? 0);
}

function lapProgressMetersFromSnapshotCar(car) {
  const progressMeters = Number(car?.lapProgressMeters ?? car?.progressMeters);
  if (Number.isFinite(progressMeters)) return progressMeters;
  return simUnitsToMeters(car?.progress ?? 0);
}

function carsById(snapshot) {
  return new Map(snapshot.cars.map((car) => [car.id, car]));
}

function completedLaps(car) {
  return car?.lapTelemetry?.completedLaps ?? 0;
}

function recordedLapTime(car) {
  const duration = car?.lapTelemetry?.lastLapTime;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}
