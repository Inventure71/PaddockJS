export function getCarRayOrigin(car) {
  return {
    x: car.x,
    y: car.y,
  };
}

export function getCarRayVector(car, angleDegrees) {
  const angle = car.heading + degreesToRadians(angleDegrees);
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

export function pointOnRay(origin, ray, distance) {
  return {
    x: origin.x + ray.x * distance,
    y: origin.y + ray.y * distance,
  };
}

export function intersectAxisAlignedBoxRay(origin, ray, halfLength, halfWidth) {
  let tMin = -Infinity;
  let tMax = Infinity;
  const xRange = intersectSlab(origin.x, ray.x, -halfLength, halfLength);
  const yRange = intersectSlab(origin.y, ray.y, -halfWidth, halfWidth);
  if (!xRange || !yRange) return null;
  tMin = Math.max(tMin, xRange.min, yRange.min);
  tMax = Math.min(tMax, xRange.max, yRange.max);
  if (tMax < 0 || tMin > tMax) return null;
  return Math.max(0, tMin);
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function normalizeRelativeHeading(angle) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function intersectSlab(origin, direction, min, max) {
  if (Math.abs(direction) < 1e-9) {
    return origin >= min && origin <= max ? { min: -Infinity, max: Infinity } : null;
  }
  const first = (min - origin) / direction;
  const second = (max - origin) / direction;
  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
  };
}
