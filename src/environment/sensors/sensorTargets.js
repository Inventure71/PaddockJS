import {
  isNearbyDetectable,
  isRayDetectable,
} from '../../simulation/participants/participantInteractions.js';

export const SENSOR_TARGET_CAR = 'car';
export const SENSOR_TARGET_REPLAY_GHOST = 'replayGhost';

export function rayDetectableTargets(self, snapshot) {
  return rayDetectableTargetsForSnapshot(snapshot).filter((target) => target.id !== self.id);
}

export function nearbyDetectableTargets(self, snapshot) {
  return nearbyDetectableTargetsForSnapshot(snapshot).filter((target) => target.id !== self.id);
}

export function rayDetectableTargetsForSnapshot(snapshot) {
  return [
    ...detectableCars(snapshot, isRayDetectable),
    ...detectableReplayGhosts(snapshot, 'detectableByRays'),
  ];
}

export function nearbyDetectableTargetsForSnapshot(snapshot) {
  return [
    ...detectableCars(snapshot, isNearbyDetectable),
    ...detectableReplayGhosts(snapshot, 'detectableAsNearby'),
  ];
}

function detectableCars(snapshot, predicate) {
  return (snapshot.cars ?? [])
    .filter((car) => predicate(car))
    .map((car, order) => ({
      entityType: SENSOR_TARGET_CAR,
      id: car.id,
      x: car.x,
      y: car.y,
      heading: car.heading,
      speedKph: car.speedKph ?? 0,
      lap: car.lap,
      order,
    }));
}

function detectableReplayGhosts(snapshot, sensorFlag) {
  const carCount = snapshot.cars?.length ?? 0;
  return (snapshot.replayGhosts ?? [])
    .filter((ghost) => ghost.sensors?.[sensorFlag] === true)
    .map((ghost, index) => ({
      entityType: SENSOR_TARGET_REPLAY_GHOST,
      id: ghost.id,
      x: ghost.x,
      y: ghost.y,
      heading: ghost.heading,
      speedKph: ghost.speedKph ?? 0,
      lap: null,
      order: carCount + index,
    }));
}
