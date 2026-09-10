import { clamp } from '../simMath.js';
import { SIM_UNITS_PER_METER } from '../units.js';
import { ADVANCED_VEHICLE_MODEL } from './advancedVehicleModel.js';
import { VEHICLE_GEOMETRY } from './vehicleGeometry.js';

function inverseMass(car, fixed) {
  if (fixed) return 0;
  return 1 / (Number.isFinite(car.mass) && car.mass > 0 ? car.mass : 798);
}

function supportOffset(car, normalX, normalY, coordinate) {
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  const along = normalX * cos + normalY * sin;
  const across = -normalX * sin + normalY * cos;
  // A normal parallel to a face selects its center, rather than an arbitrary corner.
  const longitudinal = Math.abs(along) < 1e-10 ? 0 : Math.sign(along) * VEHICLE_GEOMETRY.bodyLength / 2;
  const lateral = Math.abs(across) < 1e-10 ? 0 : Math.sign(across) * VEHICLE_GEOMETRY.bodyWidth / 2;
  return coordinate === 'x' ? cos * longitudinal - sin * lateral : sin * longitudinal + cos * lateral;
}

function velocityComponent(car, coordinate) {
  if (Number.isFinite(car.velocityX) && Number.isFinite(car.velocityY)) {
    return coordinate === 'x' ? car.velocityX : car.velocityY;
  }
  return (coordinate === 'x' ? Math.cos(car.heading) : Math.sin(car.heading)) * car.speed;
}

function writeVelocity(car, velocityX, velocityY, yawRate) {
  car.velocityX = velocityX * SIM_UNITS_PER_METER;
  car.velocityY = velocityY * SIM_UNITS_PER_METER;
  car.speed = Math.hypot(car.velocityX, car.velocityY);
  car.yawRate = yawRate;
}

export function applyAdvancedContactResponse(first, second, axis, {
  restitution = 0,
  firstFixed = false,
  secondFixed = false,
} = {}) {
  const axisLength = Math.hypot(axis.x, axis.y);
  if (!(axisLength > 0)) return 0;
  const nx = axis.x / axisLength;
  const ny = axis.y / axisLength;
  const firstInverseMass = inverseMass(first, firstFixed);
  const secondInverseMass = inverseMass(second, secondFixed);
  if (firstInverseMass + secondInverseMass === 0) return 0;
  const firstInverseInertia = firstInverseMass / ADVANCED_VEHICLE_MODEL.yawInertiaPerMass;
  const secondInverseInertia = secondInverseMass / ADVANCED_VEHICLE_MODEL.yawInertiaPerMass;

  let firstLever = 0;
  let secondLever = 0;
  if ([first.x, first.y, second.x, second.y].every(Number.isFinite)) {
    // SAT supplies a normal but no clipped contact manifold. Approximate a common
    // contact point by the midpoint of opposing body support features. This keeps
    // equal/opposite impulses and their moments consistent without rewinding poses.
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const supportX = supportOffset(first, nx, ny, 'x') + supportOffset(second, -nx, -ny, 'x');
    const supportY = supportOffset(first, nx, ny, 'y') + supportOffset(second, -nx, -ny, 'y');
    firstLever = ((dx + supportX) * ny - (dy + supportY) * nx) / (2 * SIM_UNITS_PER_METER);
    secondLever = ((-dx + supportX) * ny - (-dy + supportY) * nx) / (2 * SIM_UNITS_PER_METER);
  }

  let firstVX = velocityComponent(first, 'x') / SIM_UNITS_PER_METER;
  let firstVY = velocityComponent(first, 'y') / SIM_UNITS_PER_METER;
  let secondVX = velocityComponent(second, 'x') / SIM_UNITS_PER_METER;
  let secondVY = velocityComponent(second, 'y') / SIM_UNITS_PER_METER;
  let firstYaw = first.yawRate ?? 0;
  let secondYaw = second.yawRate ?? 0;
  const closingVelocity = (secondVX - firstVX) * nx + (secondVY - firstVY) * ny +
    secondYaw * secondLever - firstYaw * firstLever;
  let impulse = 0;
  if (closingVelocity < 0) {
    const inverseEffectiveMass = firstInverseMass + secondInverseMass +
      firstLever * firstLever * firstInverseInertia + secondLever * secondLever * secondInverseInertia;
    impulse = -(1 + clamp(restitution, 0, 1)) * closingVelocity / inverseEffectiveMass;
    firstVX -= impulse * nx * firstInverseMass;
    firstVY -= impulse * ny * firstInverseMass;
    secondVX += impulse * nx * secondInverseMass;
    secondVY += impulse * ny * secondInverseMass;
    firstYaw -= impulse * firstLever * firstInverseInertia;
    secondYaw += impulse * secondLever * secondInverseInertia;
  }

  if (!firstFixed) writeVelocity(first, firstVX, firstVY, firstYaw);
  if (!secondFixed) writeVelocity(second, secondVX, secondVY, secondYaw);
  return impulse;
}
