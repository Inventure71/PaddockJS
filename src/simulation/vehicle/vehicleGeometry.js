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

function offsetPoint(center, axes, longitudinal, lateral) {
  return {
    x: center.x + axes.forward.x * longitudinal + axes.right.x * lateral,
    y: center.y + axes.forward.y * longitudinal + axes.right.y * lateral,
  };
}

export function createOrientedRect({ id, type, center, heading, length, width }) {
  const axes = vehicleAxes(heading);
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const corners = [
    offsetPoint(center, axes, halfLength, halfWidth),
    offsetPoint(center, axes, halfLength, -halfWidth),
    offsetPoint(center, axes, -halfLength, -halfWidth),
    offsetPoint(center, axes, -halfLength, halfWidth),
  ];

  return {
    id,
    type,
    center,
    heading,
    length,
    width,
    halfLength,
    halfWidth,
    forward: axes.forward,
    right: axes.right,
    corners,
  };
}

export function createVehicleGeometry(car, options = {}) {
  const pose = vehiclePose(car, options);
  const axes = vehicleAxes(pose.heading);
  const center = { x: pose.x, y: pose.y };
  const body = createOrientedRect({
    id: 'body',
    type: 'body',
    center,
    heading: pose.heading,
    length: VEHICLE_GEOMETRY.bodyLength,
    width: VEHICLE_GEOMETRY.bodyWidth,
  });
  const wheels = WHEEL_SPECS.map((spec) => {
    const wheelCenter = offsetPoint(
      center,
      axes,
      spec.longitudinal * VEHICLE_GEOMETRY.wheelLongitudinalOffset,
      spec.lateral * VEHICLE_GEOMETRY.wheelLateralOffset,
    );
    return createOrientedRect({
      id: spec.id,
      type: 'wheel',
      center: wheelCenter,
      heading: pose.heading,
      length: VEHICLE_GEOMETRY.wheelLength,
      width: VEHICLE_GEOMETRY.wheelWidth,
    });
  });

  return {
    body,
    wheels,
    contactPatches: wheels,
    shapes: [body, ...wheels],
  };
}

function geometryPoseSignature(pose) {
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
  const x = finiteOr(car.x, 0);
  const y = finiteOr(car.y, 0);
  const heading = normalizeAngle(finiteOr(car.heading, 0));
  return {
    x,
    y,
    heading,
    previousX: finiteOr(car.previousX, x),
    previousY: finiteOr(car.previousY, y),
    previousHeading: normalizeAngle(finiteOr(car.previousHeading, heading)),
  };
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
  const current = createVehicleGeometry(car);
  const previous = createVehicleGeometry(car, { previous: true });
  const bodyAabb = createVehicleShapeAabb(current.body);
  const previousBodyAabb = createVehicleShapeAabb(previous.body);
  const sweptBodyAabb = mergeAabbs([previousBodyAabb, bodyAabb]);

  return {
    pose,
    signature: geometryPoseSignature(pose),
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

export function getVehicleGeometryState(car) {
  if (geometryStateMatches(car, car.geometryState)) return car.geometryState;
  car.geometryState = createVehicleGeometryState(car);
  return car.geometryState;
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
