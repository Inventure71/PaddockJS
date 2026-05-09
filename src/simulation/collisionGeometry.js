import {
  createVehicleGeometry,
  createVehicleGeometryState,
  getVehicleGeometryState,
  interpolateVehiclePose,
} from './vehicleGeometry.js';

const DEFAULT_SWEEP_STEPS = 16;
const BROADPHASE_PADDING = 0.001;
const DEFAULT_DISTANCE_WINDOW = 150;

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function projectShape(shape, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < shape.corners.length; index += 1) {
    const value = dot(shape.corners[index], axis);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return {
    min,
    max,
  };
}

function overlapOnAxis(first, second, axis) {
  const a = projectShape(first, axis);
  const b = projectShape(second, axis);
  return Math.min(a.max, b.max) - Math.max(a.min, b.min);
}

function shapeContactType(firstShape, secondShape) {
  return `${firstShape.type}-${secondShape.type}`;
}

export function detectShapeCollision(firstShape, secondShape) {
  const axes = [
    firstShape.forward,
    firstShape.right,
    secondShape.forward,
    secondShape.right,
  ];
  let depth = Infinity;
  let axis = null;

  for (const candidate of axes) {
    const overlap = overlapOnAxis(firstShape, secondShape, candidate);
    if (overlap <= 0) return null;
    if (overlap < depth) {
      depth = overlap;
      axis = candidate;
    }
  }

  const direction = {
    x: secondShape.center.x - firstShape.center.x,
    y: secondShape.center.y - firstShape.center.y,
  };
  if (dot(direction, axis) < 0) {
    axis = { x: -axis.x, y: -axis.y };
  }

  return {
    axis,
    depth,
    firstShapeId: firstShape.id,
    secondShapeId: secondShape.id,
    contactType: shapeContactType(firstShape, secondShape),
  };
}

function collisionShapes(geometry) {
  return [geometry.body];
}

function detectGeometryCollision(firstGeometry, secondGeometry) {
  let best = null;
  collisionShapes(firstGeometry).forEach((firstShape) => {
    collisionShapes(secondGeometry).forEach((secondShape) => {
      const collision = detectShapeCollision(firstShape, secondShape);
      if (!collision) return;
      if (!best || collision.depth < best.depth - 1e-6) {
        best = collision;
      }
    });
  });
  return best;
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

function withCollisionMetadata(collision, timeOfImpact, swept) {
  return {
    ...collision,
    timeOfImpact,
    swept: Boolean(swept),
  };
}

export function detectVehicleCollision(first, second, { sweepSteps = DEFAULT_SWEEP_STEPS } = {}) {
  const firstState = getVehicleGeometryState(first);
  const secondState = getVehicleGeometryState(second);
  const current = detectGeometryCollision(firstState.current, secondState.current);
  if (current) return withCollisionMetadata(current, 1, false);

  if (!aabbsOverlap(createSweptAabb(first), createSweptAabb(second))) return null;

  for (let step = 1; step < sweepSteps; step += 1) {
    const amount = step / sweepSteps;
    const collision = detectGeometryCollision(
      createVehicleGeometryState(interpolateVehiclePose(first, amount)).current,
      createVehicleGeometryState(interpolateVehiclePose(second, amount)).current,
    );
    if (collision) return withCollisionMetadata(collision, amount, true);
  }

  return null;
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
} = {}) {
  const candidates = [];
  const withDistance = [];
  const withoutDistance = [];

  cars.forEach((car) => {
    const distance = normalizedDistance(car, trackLength);
    if (Number.isFinite(distance)) withDistance.push({ car, distance });
    else withoutDistance.push(car);
  });

  withDistance.sort((first, second) => first.distance - second.distance);
  for (let i = 0; i < withDistance.length; i += 1) {
    for (let j = i + 1; j < withDistance.length; j += 1) {
      const delta = Number.isFinite(trackLength) && trackLength > 0
        ? wrappedDistanceDelta(withDistance[i].distance, withDistance[j].distance, trackLength)
        : withDistance[j].distance - withDistance[i].distance;
      if (delta > distanceWindow && (!Number.isFinite(trackLength) || trackLength <= 0)) {
        break;
      }
      if (delta <= distanceWindow) candidates.push([withDistance[i].car, withDistance[j].car]);
    }
  }

  const missingDistance = new Set(withoutDistance);
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      if (missingDistance.has(cars[i]) || missingDistance.has(cars[j])) {
        candidates.push([cars[i], cars[j]]);
      }
    }
  }

  return candidates;
}
