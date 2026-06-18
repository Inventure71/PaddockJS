import { getVehicleGeometryState } from './vehicle/vehicleGeometry.js';
import { normalizeAngle } from './simMath.js';

const DEFAULT_SWEEP_STEPS = 16;
const BROADPHASE_PADDING = 0.001;
const DEFAULT_DISTANCE_WINDOW = 150;
const COLLISION_PAIR_FIRST_INDEX = Symbol('collisionPairFirstIndex');
const COLLISION_PAIR_SECOND_INDEX = Symbol('collisionPairSecondIndex');

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function projectShapeInto(target, shape, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < shape.corners.length; index += 1) {
    const corner = shape.corners[index];
    const value = corner.x * axis.x + corner.y * axis.y;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  target.min = min;
  target.max = max;
  return target;
}

function overlapOnAxis(first, second, axis, projectionScratch = null) {
  const projections = projectionScratch ?? {
    first: { min: Infinity, max: -Infinity },
    second: { min: Infinity, max: -Infinity },
  };
  const a = projectShapeInto(projections.first, first, axis);
  const b = projectShapeInto(projections.second, second, axis);
  return Math.min(a.max, b.max) - Math.max(a.min, b.min);
}

function shapeContactType(firstShape, secondShape) {
  return `${firstShape.type}-${secondShape.type}`;
}

export function detectShapeCollision(firstShape, secondShape, scratch = null) {
  const projectionScratch = ensureProjectionScratch(scratch);
  let axis = firstShape.forward;
  let depth = overlapOnAxis(firstShape, secondShape, axis, projectionScratch);
  if (depth <= 0) return null;

  let overlap = overlapOnAxis(firstShape, secondShape, firstShape.right, projectionScratch);
  if (overlap <= 0) return null;
  if (overlap < depth) {
    depth = overlap;
    axis = firstShape.right;
  }

  overlap = overlapOnAxis(firstShape, secondShape, secondShape.forward, projectionScratch);
  if (overlap <= 0) return null;
  if (overlap < depth) {
    depth = overlap;
    axis = secondShape.forward;
  }

  overlap = overlapOnAxis(firstShape, secondShape, secondShape.right, projectionScratch);
  if (overlap <= 0) return null;
  if (overlap < depth) {
    depth = overlap;
    axis = secondShape.right;
  }

  const directionX = secondShape.center.x - firstShape.center.x;
  const directionY = secondShape.center.y - firstShape.center.y;
  const directionSign = directionX * axis.x + directionY * axis.y < 0 ? -1 : 1;
  return writeShapeCollisionResult(
    scratch ? (scratch.shapeCollisionResult ??= { axis: {} }) : { axis: {} },
    firstShape,
    secondShape,
    axis.x * directionSign,
    axis.y * directionSign,
    depth,
  );
}

function aabbsOverlap(first, second) {
  return (
    first.minX - BROADPHASE_PADDING <= second.maxX &&
    first.maxX + BROADPHASE_PADDING >= second.minX &&
    first.minY - BROADPHASE_PADDING <= second.maxY &&
    first.maxY + BROADPHASE_PADDING >= second.minY
  );
}

function createSweptAabb(car) {
  return getVehicleGeometryState(car).sweptBodyAabb;
}

function writeShapeCollisionResult(target, firstShape, secondShape, axisX, axisY, depth) {
  target.axis ??= {};
  target.axis.x = axisX;
  target.axis.y = axisY;
  target.depth = depth;
  target.firstShapeId = firstShape.id;
  target.secondShapeId = secondShape.id;
  target.contactType = shapeContactType(firstShape, secondShape);
  return target;
}

function withCollisionMetadata(collision, timeOfImpact, swept, scratch) {
  const target = scratch ? (scratch.vehicleCollisionResult ??= { axis: {} }) : { axis: {} };
  target.axis ??= {};
  target.axis.x = collision.axis.x;
  target.axis.y = collision.axis.y;
  target.depth = collision.depth;
  target.firstShapeId = collision.firstShapeId;
  target.secondShapeId = collision.secondShapeId;
  target.contactType = collision.contactType;
  target.timeOfImpact = timeOfImpact;
  target.swept = Boolean(swept);
  return target;
}

function detectVehicleCollisionWithScratch(first, second, sweepSteps, scratch) {
  const firstState = getVehicleGeometryState(first);
  const secondState = getVehicleGeometryState(second);
  const current = detectShapeCollision(firstState.current.body, secondState.current.body, scratch);
  if (current) return withCollisionMetadata(current, 1, false, scratch);

  if (!aabbsOverlap(createSweptAabb(first), createSweptAabb(second))) return null;

  const sweepShapes = ensureSweepShapes(scratch, firstState.current.body, secondState.current.body);
  for (let step = 1; step < sweepSteps; step += 1) {
    const amount = step / sweepSteps;
    const collision = detectShapeCollision(
      writeInterpolatedBodyShape(sweepShapes.first, firstState, amount),
      writeInterpolatedBodyShape(sweepShapes.second, secondState, amount),
      scratch,
    );
    if (collision) return withCollisionMetadata(collision, amount, true, scratch);
  }

  return null;
}

export function detectVehicleCollision(first, second, {
  sweepSteps = DEFAULT_SWEEP_STEPS,
  scratch = null,
} = {}) {
  return detectVehicleCollisionWithScratch(first, second, sweepSteps, scratch);
}

function normalizedDistance(car, trackLength) {
  if (!Number.isFinite(trackLength) || trackLength <= 0) return car.raceDistance;
  const distance = Number.isFinite(car.progress) ? car.progress : car.raceDistance;
  if (!Number.isFinite(distance)) return null;
  return ((distance % trackLength) + trackLength) % trackLength;
}

function wrappedDistanceDelta(first, second, trackLength) {
  const delta = Math.abs(first - second);
  return Math.min(delta, trackLength - delta);
}

export function buildCollisionCandidatePairs(cars, {
  trackLength = null,
  distanceWindow = DEFAULT_DISTANCE_WINDOW,
  scratch = null,
} = {}) {
  const candidates = scratchArray(scratch, 'candidates');
  const pairMarker = candidatePairMarker(scratch, cars.length);
  const withDistance = scratchArray(scratch, 'withDistance');
  const pairPool = scratchArray(scratch, 'pairPool', { clear: false });
  const distanceEntryPool = scratchArray(scratch, 'distanceEntryPool', { clear: false });
  const missingDistanceFlags = missingDistanceFlagScratch(scratch, cars.length);
  const missingDistanceIndexes = scratchArray(scratch, 'missingDistanceIndexes');

  const addCandidateByIndex = (firstIndex, secondIndex) => {
    if (pairMarker.has(firstIndex, secondIndex)) return;
    pairMarker.add(firstIndex, secondIndex);
    const pair = pairPool[candidates.length] ?? [];
    pair[0] = cars[firstIndex];
    pair[1] = cars[secondIndex];
    pair[COLLISION_PAIR_FIRST_INDEX] = firstIndex;
    pair[COLLISION_PAIR_SECOND_INDEX] = secondIndex;
    pairPool[candidates.length] = pair;
    candidates.push(pair);
  };

  for (let index = 0; index < cars.length; index += 1) {
    const car = cars[index];
    missingDistanceFlags[index] = 0;
    const distance = normalizedDistance(car, trackLength);
    if (Number.isFinite(distance)) {
      const entry = distanceEntryPool[withDistance.length] ?? {};
      entry.car = car;
      entry.carIndex = index;
      entry.distance = distance;
      distanceEntryPool[withDistance.length] = entry;
      withDistance.push(entry);
    } else {
      missingDistanceFlags[index] = 1;
      missingDistanceIndexes.push(index);
    }
  }

  withDistance.sort((first, second) => first.distance - second.distance);
  for (let i = 0; i < withDistance.length; i += 1) {
    for (let j = i + 1; j < withDistance.length; j += 1) {
      const delta = withDistance[j].distance - withDistance[i].distance;
      if (delta > distanceWindow) break;
      addCandidateByIndex(withDistance[i].carIndex, withDistance[j].carIndex);
    }
  }

  if (Number.isFinite(trackLength) && trackLength > 0) {
    for (let i = 0; i < withDistance.length; i += 1) {
      const threshold = withDistance[i].distance + trackLength - distanceWindow;
      const firstWrappedIndex = lowerBoundDistance(withDistance, threshold);
      for (let j = Math.max(firstWrappedIndex, i + 1); j < withDistance.length; j += 1) {
        if (wrappedDistanceDelta(withDistance[i].distance, withDistance[j].distance, trackLength) <= distanceWindow) {
          addCandidateByIndex(withDistance[i].carIndex, withDistance[j].carIndex);
        }
      }
    }
  }

  if (missingDistanceIndexes.length > 0) {
    for (let i = 0; i < cars.length; i += 1) {
      for (let j = i + 1; j < cars.length; j += 1) {
        if (missingDistanceFlags[i] || missingDistanceFlags[j]) {
          addCandidateByIndex(i, j);
        }
      }
    }
  }

  return candidates;
}

export function collisionCandidatePairFirstIndex(pair) {
  return Number.isInteger(pair?.[COLLISION_PAIR_FIRST_INDEX])
    ? pair[COLLISION_PAIR_FIRST_INDEX]
    : -1;
}

export function collisionCandidatePairSecondIndex(pair) {
  return Number.isInteger(pair?.[COLLISION_PAIR_SECOND_INDEX])
    ? pair[COLLISION_PAIR_SECOND_INDEX]
    : -1;
}

function scratchArray(scratch, key, { clear = true } = {}) {
  const array = scratch ? (scratch[key] ??= []) : [];
  if (clear) array.length = 0;
  return array;
}

function candidatePairMarker(scratch, carCount) {
  if (!scratch) return setBackedCandidatePairMarker(carCount);
  const requiredLength = Math.max(1, carCount * carCount);
  if (!(scratch.candidatePairMarks instanceof Uint32Array) || scratch.candidatePairMarks.length < requiredLength) {
    scratch.candidatePairMarks = new Uint32Array(requiredLength);
  }
  scratch.candidatePairEpoch = ((scratch.candidatePairEpoch ?? 0) + 1) >>> 0;
  if (scratch.candidatePairEpoch === 0) {
    scratch.candidatePairMarks.fill(0);
    scratch.candidatePairEpoch = 1;
  }
  const marks = scratch.candidatePairMarks;
  const epoch = scratch.candidatePairEpoch;
  return {
    has(firstIndex, secondIndex) {
      return marks[candidatePairMarkIndex(firstIndex, secondIndex, carCount)] === epoch;
    },
    add(firstIndex, secondIndex) {
      marks[candidatePairMarkIndex(firstIndex, secondIndex, carCount)] = epoch;
    },
  };
}

function missingDistanceFlagScratch(scratch, carCount) {
  if (!scratch) return new Uint8Array(Math.max(1, carCount));
  if (!(scratch.missingDistanceFlags instanceof Uint8Array) || scratch.missingDistanceFlags.length < carCount) {
    scratch.missingDistanceFlags = new Uint8Array(Math.max(1, carCount));
  }
  return scratch.missingDistanceFlags;
}

function setBackedCandidatePairMarker(carCount) {
  const marks = new Uint32Array(Math.max(1, carCount * carCount));
  return {
    has(firstIndex, secondIndex) {
      return marks[candidatePairMarkIndex(firstIndex, secondIndex, carCount)] === 1;
    },
    add(firstIndex, secondIndex) {
      marks[candidatePairMarkIndex(firstIndex, secondIndex, carCount)] = 1;
    },
  };
}

function candidatePairMarkIndex(firstIndex, secondIndex, carCount) {
  const low = firstIndex < secondIndex ? firstIndex : secondIndex;
  const high = firstIndex < secondIndex ? secondIndex : firstIndex;
  return low * carCount + high;
}

function ensureSweepShapes(scratch, firstBody, secondBody) {
  const sweepShapes = scratch ? (scratch.sweepShapes ??= {}) : {};
  sweepShapes.first ??= createSweepShape(firstBody);
  sweepShapes.second ??= createSweepShape(secondBody);
  return sweepShapes;
}

function ensureProjectionScratch(scratch) {
  const projectionScratch = scratch ? (scratch.projectionScratch ??= {}) : {};
  projectionScratch.first ??= { min: Infinity, max: -Infinity };
  projectionScratch.second ??= { min: Infinity, max: -Infinity };
  return projectionScratch;
}

function createSweepShape(body) {
  return {
    id: body.id,
    type: body.type,
    center: { x: body.center.x, y: body.center.y },
    heading: body.heading,
    length: body.length,
    width: body.width,
    halfLength: body.halfLength,
    halfWidth: body.halfWidth,
    forward: { x: body.forward.x, y: body.forward.y },
    right: { x: body.right.x, y: body.right.y },
    corners: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
  };
}

function writeInterpolatedBodyShape(target, geometryState, amount) {
  const pose = geometryState.pose;
  const headingDelta = normalizeAngle(pose.heading - pose.previousHeading);
  const x = pose.previousX + (pose.x - pose.previousX) * amount;
  const y = pose.previousY + (pose.y - pose.previousY) * amount;
  const heading = normalizeAngle(pose.previousHeading + headingDelta * amount);
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const halfLength = target.halfLength;
  const halfWidth = target.halfWidth;

  target.center.x = x;
  target.center.y = y;
  target.heading = heading;
  target.forward.x = cos;
  target.forward.y = sin;
  target.right.x = -sin;
  target.right.y = cos;

  writeOffsetCorner(target.corners[0], target.center, target.forward, target.right, halfLength, halfWidth);
  writeOffsetCorner(target.corners[1], target.center, target.forward, target.right, halfLength, -halfWidth);
  writeOffsetCorner(target.corners[2], target.center, target.forward, target.right, -halfLength, -halfWidth);
  writeOffsetCorner(target.corners[3], target.center, target.forward, target.right, -halfLength, halfWidth);

  return target;
}

function writeOffsetCorner(target, center, forward, right, longitudinal, lateral) {
  target.x = center.x + forward.x * longitudinal + right.x * lateral;
  target.y = center.y + forward.y * longitudinal + right.y * lateral;
  return target;
}

function lowerBoundDistance(entries, target) {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].distance < target) low = middle + 1;
    else high = middle;
  }
  return low;
}
