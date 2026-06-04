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

function writeOrientedRect(target, { id, type, center, heading, length, width }) {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return writeOrientedRectValues(target, {
    id,
    type,
    centerX: center.x,
    centerY: center.y,
    heading,
    length,
    width,
    forwardX: cos,
    forwardY: sin,
    rightX: -sin,
    rightY: cos,
  });
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

export function createOrientedRect({ id, type, center, heading, length, width }) {
  return writeOrientedRect(null, { id, type, center, heading, length, width });
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

function geometryPose(car) {
  const { x, y, heading } = currentPoseState(car);
  return {
    x,
    y,
    heading,
    previousX: finiteOr(car.previousX, x),
    previousY: finiteOr(car.previousY, y),
    previousHeading: normalizeAngle(finiteOr(car.previousHeading, heading)),
  };
}

function currentGeometryStateMatches(car, state) {
  const pose = state?.pose;
  if (!pose) return false;
  const currentPose = currentPoseState(car);
  return (
    pose.x === currentPose.x &&
    pose.y === currentPose.y &&
    pose.heading === currentPose.heading
  );
}

function geometryStateMatches(car, state) {
  const pose = state?.pose;
  if (!pose) return false;
  const { x, y, heading } = currentPoseState(car);
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
  return {
    minX,
    maxX,
    minY,
    maxY,
  };
}

export function mergeAabbs(aabbs) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < aabbs.length; index += 1) {
    const aabb = aabbs[index];
    if (aabb.minX < minX) minX = aabb.minX;
    if (aabb.maxX > maxX) maxX = aabb.maxX;
    if (aabb.minY < minY) minY = aabb.minY;
    if (aabb.maxY > maxY) maxY = aabb.maxY;
  }
  return { minX, maxX, minY, maxY };
}

export function createVehicleGeometryState(car) {
  const pose = geometryPose(car);
  const current = writeVehicleGeometry(null, pose);
  const previous = writeVehicleGeometry(null, {
    x: pose.previousX,
    y: pose.previousY,
    heading: pose.previousHeading,
  });
  const bodyAabb = createVehicleShapeAabb(current.body);
  const previousBodyAabb = createVehicleShapeAabb(previous.body);
  const sweptBodyAabb = mergeAabbs([previousBodyAabb, bodyAabb]);

  return {
    pose,
    currentSignature: currentPoseSignature(pose),
    sweptSignature: sweptPoseSignature(pose),
    signature: sweptPoseSignature(pose),
    current,
    previous,
    body: current.body,
    wheels: current.wheels,
    contactPatches: current.contactPatches,
    bodyAabb,
    previousBodyAabb,
    sweptBodyAabb,
  };
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
  car.geometryState = createVehicleGeometryState(car);
  return car.geometryState;
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

export function createVehicleAabb(car, options = {}) {
  const geometry = createVehicleGeometry(car, options);
  return mergeAabbs(geometry.shapes.map(createVehicleShapeAabb));
}

export function interpolateVehiclePose(car, amount) {
  const previousX = finiteOr(car.previousX, car.x);
  const previousY = finiteOr(car.previousY, car.y);
  const previousHeading = finiteOr(car.previousHeading, car.heading);
  const headingDelta = normalizeAngle(finiteOr(car.heading, 0) - previousHeading);

  return {
    ...car,
    x: previousX + (finiteOr(car.x, previousX) - previousX) * amount,
    y: previousY + (finiteOr(car.y, previousY) - previousY) * amount,
    heading: normalizeAngle(previousHeading + headingDelta * amount),
  };
}

export function getCarCorners(car) {
  return createVehicleGeometry(car).body.corners;
}
