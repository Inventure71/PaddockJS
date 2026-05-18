import { normalizeAngle } from '../simMath.js';

export function angleToPoint(car, target) {
  const angle = Math.atan2(target.y - car.y, target.x - car.x);
  return normalizeAngle(angle - car.heading);
}
