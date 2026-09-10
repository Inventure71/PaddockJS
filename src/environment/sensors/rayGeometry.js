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

export function intersectAxisAlignedBoxRayScalars(originX, originY, rayX, rayY, halfLength, halfWidth) {
  let tMin = -Infinity;
  let tMax = Infinity;

  if (Math.abs(rayX) < 1e-9) {
    if (originX < -halfLength || originX > halfLength) return null;
  } else {
    const first = (-halfLength - originX) / rayX;
    const second = (halfLength - originX) / rayX;
    tMin = Math.max(tMin, Math.min(first, second));
    tMax = Math.min(tMax, Math.max(first, second));
  }

  if (Math.abs(rayY) < 1e-9) {
    if (originY < -halfWidth || originY > halfWidth) return null;
  } else {
    const first = (-halfWidth - originY) / rayY;
    const second = (halfWidth - originY) / rayY;
    tMin = Math.max(tMin, Math.min(first, second));
    tMax = Math.min(tMax, Math.max(first, second));
  }

  if (tMax < 0 || tMin > tMax) return null;
  return Math.max(0, tMin);
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
