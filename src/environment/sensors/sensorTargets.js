import {
  isNearbyDetectable,
  isRayDetectable,
} from '../../simulation/participants/participantInteractions.js';

export const SENSOR_TARGET_CAR = 'car';
export const SENSOR_TARGET_REPLAY_GHOST = 'replayGhost';

export function rayDetectableTargets(self, snapshot) {
  return rayDetectableTargetsForSnapshot(snapshot).filter((target) => !isSelfCarTarget(self, target));
}

export function nearbyDetectableTargets(self, snapshot) {
  return nearbyDetectableTargetsForSnapshot(snapshot).filter((target) => !isSelfCarTarget(self, target));
}

export function rayDetectableTargetsForSnapshot(snapshot, scratch = null) {
  if (scratch) {
    return writeRayDetectableTargetsForSnapshot(snapshot, scratch);
  }
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
      velocityX: car.velocityX,
      velocityY: car.velocityY,
      speedKph: car.speedKph ?? 0,
      lap: car.lap,
      order,
    }));
}

function writeRayDetectableTargetsForSnapshot(snapshot, scratch) {
  const targets = scratch.rayTargets ?? [];
  const pool = scratch.rayTargetPool ?? [];
  scratch.rayTargets = targets;
  scratch.rayTargetPool = pool;
  let count = 0;
  let carOrder = 0;
  const cars = snapshot.cars ?? [];
  for (let index = 0; index < cars.length; index += 1) {
    const car = cars[index];
    if (!isRayDetectable(car)) continue;
    const target = pool[count] ?? {};
    pool[count] = target;
    writeCarTarget(target, car, carOrder);
    targets[count] = target;
    count += 1;
    carOrder += 1;
  }
  let ghostOrder = 0;
  const carCount = cars.length;
  const replayGhosts = snapshot.replayGhosts ?? [];
  for (let index = 0; index < replayGhosts.length; index += 1) {
    const ghost = replayGhosts[index];
    if (ghost.sensors?.detectableByRays !== true) continue;
    const target = pool[count] ?? {};
    pool[count] = target;
    writeReplayGhostTarget(target, ghost, carCount + ghostOrder);
    targets[count] = target;
    count += 1;
    ghostOrder += 1;
  }
  targets.length = count;
  return targets;
}

function writeCarTarget(target, car, order) {
  target.entityType = SENSOR_TARGET_CAR;
  target.id = car.id;
  target.x = car.x;
  target.y = car.y;
  target.heading = car.heading;
  target.velocityX = car.velocityX;
  target.velocityY = car.velocityY;
  target.speedKph = car.speedKph ?? 0;
  target.lap = car.lap;
  target.order = order;
  return target;
}

function writeReplayGhostTarget(target, ghost, order) {
  target.entityType = SENSOR_TARGET_REPLAY_GHOST;
  target.id = ghost.id;
  target.x = ghost.x;
  target.y = ghost.y;
  target.heading = ghost.heading;
  target.velocityX = undefined;
  target.velocityY = undefined;
  target.speedKph = ghost.speedKph ?? 0;
  target.lap = null;
  target.order = order;
  return target;
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

export function isSelfCarTarget(self, target) {
  return target.entityType === SENSOR_TARGET_CAR && target.id === self.id;
}
