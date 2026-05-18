import { lerp, normalizeAngle } from '../simulation/simMath.js';

const CAR_BUFFER = Symbol('renderSnapshotCars');
const GHOST_BUFFER = Symbol('renderSnapshotGhosts');
const SAFETY_CAR_BUFFER = Symbol('renderSnapshotSafetyCar');

function interpolateAngle(previous, current, amount) {
  if (!Number.isFinite(previous)) return current;
  return previous + normalizeAngle(current - previous) * amount;
}

function interpolateMovingEntityInto(target, entity, alpha) {
  Object.assign(target, entity);
  target.x = lerp(entity.previousX ?? entity.x, entity.x, alpha);
  target.y = lerp(entity.previousY ?? entity.y, entity.y, alpha);
  target.heading = interpolateAngle(entity.previousHeading ?? entity.heading, entity.heading, alpha);
  return target;
}

function interpolateEntityListInto(sourceEntities = [], targetEntities = [], alpha) {
  targetEntities.length = sourceEntities.length;
  for (let index = 0; index < sourceEntities.length; index += 1) {
    const source = sourceEntities[index];
    const target = targetEntities[index] ?? {};
    targetEntities[index] = interpolateMovingEntityInto(target, source, alpha);
  }
  return targetEntities;
}

export function interpolateRenderSnapshotInto(target, snapshot, alpha) {
  if (!target || typeof target !== 'object') target = {};
  const carBuffer = target[CAR_BUFFER] ?? [];
  const ghostBuffer = target[GHOST_BUFFER] ?? [];
  const safetyCarBuffer = target[SAFETY_CAR_BUFFER] ?? {};
  target[CAR_BUFFER] = carBuffer;
  target[GHOST_BUFFER] = ghostBuffer;
  target[SAFETY_CAR_BUFFER] = safetyCarBuffer;
  Object.assign(target, snapshot);
  target.cars = interpolateEntityListInto(snapshot.cars ?? [], carBuffer, alpha);
  target.replayGhosts = interpolateEntityListInto(snapshot.replayGhosts ?? [], ghostBuffer, alpha);
  target.safetyCar = snapshot.safetyCar
    ? interpolateMovingEntityInto(safetyCarBuffer, snapshot.safetyCar, alpha)
    : snapshot.safetyCar;
  return target;
}

export function createRenderSnapshot(snapshot, alpha) {
  return interpolateRenderSnapshotInto({}, snapshot, alpha);
}
