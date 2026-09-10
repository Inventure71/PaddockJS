import { normalizeAngle } from '../simMath.js';
import {
  REAL_F1_CAR_LENGTH_METERS,
  REAL_F1_CAR_WIDTH_METERS,
  REAL_F1_WHEELBASE_METERS,
  metersToSimUnits,
} from '../units.js';

export const VEHICLE_GEOMETRY = {
  visualLength: metersToSimUnits(REAL_F1_CAR_LENGTH_METERS),
  visualWidth: metersToSimUnits(REAL_F1_CAR_WIDTH_METERS),
  bodyLength: metersToSimUnits(4.65),
  bodyWidth: metersToSimUnits(1.24),
  wheelLength: metersToSimUnits(0.72),
  wheelWidth: metersToSimUnits(0.38),
  wheelLongitudinalOffset: metersToSimUnits(REAL_F1_WHEELBASE_METERS / 2),
  wheelLateralOffset: metersToSimUnits((REAL_F1_CAR_WIDTH_METERS - 0.38) / 2),
};

const WHEEL_SPECS = [
  { id: 'front-left', longitudinal: 1, lateral: -1 },
  { id: 'front-right', longitudinal: 1, lateral: 1 },
  { id: 'rear-left', longitudinal: -1, lateral: -1 },
  { id: 'rear-right', longitudinal: -1, lateral: 1 },
];

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function vehiclePose(car, { previous = false } = {}) {
  const x = previous ? finiteOr(car.previousX, car.x) : car.x;
  const y = previous ? finiteOr(car.previousY, car.y) : car.y;
  const heading = previous ? finiteOr(car.previousHeading, car.heading) : car.heading;

  return {
    x: finiteOr(x, 0),
    y: finiteOr(y, 0),
    heading: normalizeAngle(finiteOr(heading, 0)),
  };
}

export function vehicleAxes(heading) {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    forward: { x: cos, y: sin },
    right: { x: -sin, y: cos },
  };
}

function writePoint(target, x, y) {
  const point = target ?? {};
  point.x = x;
  point.y = y;
  return point;
}

function writePose(target, pose) {
  const next = target ?? {};
  next.x = pose.x;
  next.y = pose.y;
  next.heading = pose.heading;
  return next;
}

function writeCorner(target, centerX, centerY, forwardX, forwardY, rightX, rightY, longitudinal, lateral) {
  return writePoint(
    target,
    centerX + forwardX * longitudinal + rightX * lateral,
    centerY + forwardY * longitudinal + rightY * lateral,
  );
}

function writeOrientedRectValues(target, {
  id,
  type,
  centerX,
  centerY,
  heading,
  length,
  width,
  forwardX,
  forwardY,
  rightX,
  rightY,
}, { writeCorners = true } = {}) {
  const rect = target ?? {};
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const corners = writeCorners || rect.corners ? (rect.corners ?? new Array(4)) : null;

  rect.id = id;
  rect.type = type;
  rect.center = writePoint(rect.center, centerX, centerY);
  rect.heading = heading;
  rect.length = length;
  rect.width = width;
  rect.halfLength = halfLength;
  rect.halfWidth = halfWidth;
  rect.forward = writePoint(rect.forward, forwardX, forwardY);
  rect.right = writePoint(rect.right, rightX, rightY);
  if (corners) {
    corners[0] = writeCorner(corners[0], centerX, centerY, forwardX, forwardY, rightX, rightY, halfLength, halfWidth);
    corners[1] = writeCorner(corners[1], centerX, centerY, forwardX, forwardY, rightX, rightY, halfLength, -halfWidth);
    corners[2] = writeCorner(corners[2], centerX, centerY, forwardX, forwardY, rightX, rightY, -halfLength, -halfWidth);
    corners[3] = writeCorner(corners[3], centerX, centerY, forwardX, forwardY, rightX, rightY, -halfLength, halfWidth);
    rect.corners = corners;
  }
  return rect;
}

function writeVehicleGeometry(target, pose) {
  const geometry = target ?? {};
  const forwardX = Math.cos(pose.heading);
  const forwardY = Math.sin(pose.heading);
  const rightX = -forwardY;
  const rightY = forwardX;
  const wheels = geometry.wheels ?? new Array(WHEEL_SPECS.length);
  const shapes = geometry.shapes ?? new Array(1 + WHEEL_SPECS.length);

  const body = writeOrientedRectValues(geometry.body, {
    id: 'body',
    type: 'body',
    centerX: pose.x,
    centerY: pose.y,
    heading: pose.heading,
    length: VEHICLE_GEOMETRY.bodyLength,
    width: VEHICLE_GEOMETRY.bodyWidth,
    forwardX,
    forwardY,
    rightX,
    rightY,
  });

  for (let index = 0; index < WHEEL_SPECS.length; index += 1) {
    const spec = WHEEL_SPECS[index];
    const wheelCenterX =
      pose.x +
      forwardX * (spec.longitudinal * VEHICLE_GEOMETRY.wheelLongitudinalOffset) +
      rightX * (spec.lateral * VEHICLE_GEOMETRY.wheelLateralOffset);
    const wheelCenterY =
      pose.y +
      forwardY * (spec.longitudinal * VEHICLE_GEOMETRY.wheelLongitudinalOffset) +
      rightY * (spec.lateral * VEHICLE_GEOMETRY.wheelLateralOffset);
    wheels[index] = writeOrientedRectValues(wheels[index], {
      id: spec.id,
      type: 'wheel',
      centerX: wheelCenterX,
      centerY: wheelCenterY,
      heading: pose.heading,
      length: VEHICLE_GEOMETRY.wheelLength,
      width: VEHICLE_GEOMETRY.wheelWidth,
      forwardX,
      forwardY,
      rightX,
      rightY,
    });
    shapes[index + 1] = wheels[index];
  }

  shapes[0] = body;
  geometry.body = body;
  geometry.wheels = wheels;
  geometry.contactPatches = wheels;
  geometry.shapes = shapes;
  return geometry;
}

function writeCurrentVehicleGeometry(target, pose) {
  const geometry = target ?? {};
  const forwardX = Math.cos(pose.heading);
  const forwardY = Math.sin(pose.heading);
  const rightX = -forwardY;
  const rightY = forwardX;
  const wheels = geometry.wheels ?? new Array(WHEEL_SPECS.length);

  const body = writeOrientedRectValues(geometry.body, {
    id: 'body',
    type: 'body',
    centerX: pose.x,
    centerY: pose.y,
    heading: pose.heading,
    length: VEHICLE_GEOMETRY.bodyLength,
    width: VEHICLE_GEOMETRY.bodyWidth,
    forwardX,
    forwardY,
    rightX,
    rightY,
  }, { writeCorners: false });

  for (let index = 0; index < WHEEL_SPECS.length; index += 1) {
    const spec = WHEEL_SPECS[index];
    const wheelCenterX =
      pose.x +
      forwardX * (spec.longitudinal * VEHICLE_GEOMETRY.wheelLongitudinalOffset) +
      rightX * (spec.lateral * VEHICLE_GEOMETRY.wheelLateralOffset);
    const wheelCenterY =
      pose.y +
      forwardY * (spec.longitudinal * VEHICLE_GEOMETRY.wheelLongitudinalOffset) +
      rightY * (spec.lateral * VEHICLE_GEOMETRY.wheelLateralOffset);
    wheels[index] = writeOrientedRectValues(wheels[index], {
      id: spec.id,
      type: 'wheel',
      centerX: wheelCenterX,
      centerY: wheelCenterY,
      heading: pose.heading,
      length: VEHICLE_GEOMETRY.wheelLength,
      width: VEHICLE_GEOMETRY.wheelWidth,
      forwardX,
      forwardY,
      rightX,
      rightY,
    }, { writeCorners: false });
  }

  geometry.body = body;
  geometry.wheels = wheels;
  geometry.contactPatches = wheels;
  return geometry;
}

export function createVehicleGeometry(car, options = {}) {
  const pose = vehiclePose(car, options);
  return writeVehicleGeometry(null, pose);
}

function currentPoseSignature(pose) {
  return [
    pose.x,
    pose.y,
    pose.heading,
  ].join(':');
}

function currentPoseState(car) {
  return {
    x: finiteOr(car.x, 0),
    y: finiteOr(car.y, 0),
    heading: normalizeAngle(finiteOr(car.heading, 0)),
  };
}

function sweptPoseSignature(pose) {
  return [
    pose.x,
    pose.y,
    pose.heading,
    pose.previousX,
    pose.previousY,
    pose.previousHeading,
  ].join(':');
}

function currentGeometryStateMatches(car, state) {
  const pose = state?.pose;
  if (!pose) return false;
  return (
    pose.x === finiteOr(car.x, 0) &&
    pose.y === finiteOr(car.y, 0) &&
    pose.heading === normalizeAngle(finiteOr(car.heading, 0))
  );
}

function geometryStateMatches(car, state) {
  const pose = state?.pose;
  if (!pose) return false;
  const x = finiteOr(car.x, 0);
  const y = finiteOr(car.y, 0);
  const heading = normalizeAngle(finiteOr(car.heading, 0));
  return (
    pose.x === x &&
    pose.y === y &&
    pose.heading === heading &&
    pose.previousX === finiteOr(car.previousX, x) &&
    pose.previousY === finiteOr(car.previousY, y) &&
    pose.previousHeading === normalizeAngle(finiteOr(car.previousHeading, heading))
  );
}

export function createVehicleShapeAabb(shape) {
  return writeVehicleShapeAabb({}, shape);
}

function writeVehicleShapeAabb(target, shape) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < shape.corners.length; index += 1) {
    const corner = shape.corners[index];
    if (corner.x < minX) minX = corner.x;
    if (corner.x > maxX) maxX = corner.x;
    if (corner.y < minY) minY = corner.y;
    if (corner.y > maxY) maxY = corner.y;
  }
  target.minX = minX;
  target.maxX = maxX;
  target.minY = minY;
  target.maxY = maxY;
  return target;
}

function writeGeometryPose(target, car) {
  const pose = target ?? {};
  const x = finiteOr(car.x, 0);
  const y = finiteOr(car.y, 0);
  const heading = normalizeAngle(finiteOr(car.heading, 0));
  pose.x = x;
  pose.y = y;
  pose.heading = heading;
  pose.previousX = finiteOr(car.previousX, x);
  pose.previousY = finiteOr(car.previousY, y);
  pose.previousHeading = normalizeAngle(finiteOr(car.previousHeading, heading));
  return pose;
}

function createGeometryStateShell() {
  const state = {
    pose: null,
    current: null,
    previous: null,
    body: null,
    wheels: null,
    contactPatches: null,
    bodyAabb: {},
    previousBodyAabb: {},
    sweptBodyAabb: {},
  };
  // Signatures are derived lazily from the pose: nothing on the hot path reads
  // them, so the per-step string formatting cost must not be paid eagerly.
  Object.defineProperties(state, {
    currentSignature: {
      get() { return currentPoseSignature(this.pose); },
      enumerable: true,
    },
    sweptSignature: {
      get() { return sweptPoseSignature(this.pose); },
      enumerable: true,
    },
    signature: {
      get() { return sweptPoseSignature(this.pose); },
      enumerable: true,
    },
  });
  return state;
}

const PREVIOUS_GEOMETRY_POSE_SCRATCH = { x: 0, y: 0, heading: 0 };

export function createVehicleGeometryState(car, target = null) {
  const state = target ?? createGeometryStateShell();
  const pose = state.pose = writeGeometryPose(state.pose, car);
  const current = state.current = writeVehicleGeometry(state.current, pose);
  PREVIOUS_GEOMETRY_POSE_SCRATCH.x = pose.previousX;
  PREVIOUS_GEOMETRY_POSE_SCRATCH.y = pose.previousY;
  PREVIOUS_GEOMETRY_POSE_SCRATCH.heading = pose.previousHeading;
  const previous = state.previous = writeVehicleGeometry(state.previous, PREVIOUS_GEOMETRY_POSE_SCRATCH);
  const bodyAabb = writeVehicleShapeAabb(state.bodyAabb, current.body);
  const previousBodyAabb = writeVehicleShapeAabb(state.previousBodyAabb, previous.body);
  const sweptBodyAabb = state.sweptBodyAabb;
  sweptBodyAabb.minX = Math.min(bodyAabb.minX, previousBodyAabb.minX);
  sweptBodyAabb.maxX = Math.max(bodyAabb.maxX, previousBodyAabb.maxX);
  sweptBodyAabb.minY = Math.min(bodyAabb.minY, previousBodyAabb.minY);
  sweptBodyAabb.maxY = Math.max(bodyAabb.maxY, previousBodyAabb.maxY);

  state.body = current.body;
  state.wheels = current.wheels;
  state.contactPatches = current.contactPatches;
  return state;
}

export function createCurrentVehicleGeometryState(car, target = null) {
  const pose = currentPoseState(car);
  const current = writeCurrentVehicleGeometry(target?.current ?? null, pose);
  const state = target ?? {};
  state.pose = writePose(state.pose, pose);
  state.current = current;
  state.body = current.body;
  state.wheels = current.wheels;
  state.contactPatches = current.contactPatches;
  return state;
}

export function getVehicleGeometryState(car) {
  if (geometryStateMatches(car, car.geometryState)) return car.geometryState;
  // Double-buffer pooled states: consumers may still hold the state returned
  // for the previous pose within a step, so alternate between two reusable
  // shells instead of allocating a fresh geometry tree on every pose change.
  const next = createVehicleGeometryState(car, car._geometryStateSpare ?? null);
  car._geometryStateSpare = car.geometryState ?? null;
  car.geometryState = next;
  return next;
}

export function getCurrentVehicleGeometryState(car) {
  if (currentGeometryStateMatches(car, car.currentGeometryState)) return car.currentGeometryState;
  if (currentGeometryStateMatches(car, car.geometryState)) return car.geometryState;
  car.currentGeometryState = createCurrentVehicleGeometryState(car, car.currentGeometryState ?? null);
  return car.currentGeometryState;
}

export function ensureOrientedRectCorners(rect) {
  if (!rect) return [];
  if (rect.corners) return rect.corners;
  return writeOrientedRectValues(rect, {
    id: rect.id ?? null,
    type: rect.type ?? null,
    centerX: rect.center?.x ?? 0,
    centerY: rect.center?.y ?? 0,
    heading: rect.heading ?? 0,
    length: rect.length ?? 0,
    width: rect.width ?? 0,
    forwardX: rect.forward?.x ?? Math.cos(rect.heading ?? 0),
    forwardY: rect.forward?.y ?? Math.sin(rect.heading ?? 0),
    rightX: rect.right?.x ?? -Math.sin(rect.heading ?? 0),
    rightY: rect.right?.y ?? Math.cos(rect.heading ?? 0),
  }).corners;
}

export function getCarCorners(car) {
  return createVehicleGeometry(car).body.corners;
}
