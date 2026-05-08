import { normalizeAngle } from './simMath.js';

export const VEHICLE_GEOMETRY = {
  visualLength: 66,
  visualWidth: 23,
  bodyLength: 50,
  bodyWidth: 13.5,
  wheelLength: 14.5,
  wheelWidth: 5.8,
  wheelLongitudinalOffset: 20.8,
  wheelLateralOffset: 8.3,
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

function geometrySignature(car) {
  return [
    finiteOr(car.x, 0),
    finiteOr(car.y, 0),
    normalizeAngle(finiteOr(car.heading, 0)),
    finiteOr(car.previousX, finiteOr(car.x, 0)),
    finiteOr(car.previousY, finiteOr(car.y, 0)),
    normalizeAngle(finiteOr(car.previousHeading, finiteOr(car.heading, 0))),
  ].join(':');
}

export function createVehicleShapeAabb(shape) {
  const xs = shape.corners.map((corner) => corner.x);
  const ys = shape.corners.map((corner) => corner.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function mergeAabbs(aabbs) {
  return {
    minX: Math.min(...aabbs.map((aabb) => aabb.minX)),
    maxX: Math.max(...aabbs.map((aabb) => aabb.maxX)),
    minY: Math.min(...aabbs.map((aabb) => aabb.minY)),
    maxY: Math.max(...aabbs.map((aabb) => aabb.maxY)),
  };
}

export function createVehicleGeometryState(car) {
  const current = createVehicleGeometry(car);
  const previous = createVehicleGeometry(car, { previous: true });
  const bodyAabb = createVehicleShapeAabb(current.body);
  const previousBodyAabb = createVehicleShapeAabb(previous.body);
  const sweptBodyAabb = mergeAabbs([previousBodyAabb, bodyAabb]);

  return {
    signature: geometrySignature(car),
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
  const signature = geometrySignature(car);
  if (car.geometryState?.signature === signature) return car.geometryState;
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
