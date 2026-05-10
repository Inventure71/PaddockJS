import { buildCollisionCandidatePairs, detectVehicleCollision } from '../collisionGeometry.js';
import { clamp, normalizeAngle } from '../simMath.js';
import { VEHICLE_LIMITS } from '../vehiclePhysics.js';
import { shiftPreviousRenderPose } from '../pit/pitRouting.js';

const MAX_COLLISION_CORRECTION = 4.5;

function isPitPositionControlledCar(car) {
  const status = car?.pitStop?.status;
  return status === 'entering' || status === 'queued' || status === 'servicing' || status === 'exiting';
}

function forwardVector(car) {
  return { x: Math.cos(car.heading), y: Math.sin(car.heading) };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function resolveCollisionsForSimulation(sim) {
  const reportedContacts = new Set();

  for (let pass = 0; pass < 3; pass += 1) {
    const candidates = buildCollisionCandidatePairs(sim.cars, { trackLength: sim.track.length });
    for (const [first, second] of candidates) {
      const collision = detectVehicleCollision(first, second);
      if (!collision) continue;
      const firstPitControlled = isPitPositionControlledCar(first);
      const secondPitControlled = isPitPositionControlledCar(second);
      if (firstPitControlled && secondPitControlled) continue;
      const stewardCollision = {
        ...collision,
        trackLength: sim.track.length,
      };
      const oneCarFixed = firstPitControlled || secondPitControlled;

      const correction = Math.min(
        (oneCarFixed ? collision.depth : collision.depth / 2) + 0.65,
        MAX_COLLISION_CORRECTION,
      );
      const firstCorrectionX = firstPitControlled ? 0 : -collision.axis.x * correction;
      const firstCorrectionY = firstPitControlled ? 0 : -collision.axis.y * correction;
      const secondCorrectionX = secondPitControlled ? 0 : collision.axis.x * correction;
      const secondCorrectionY = secondPitControlled ? 0 : collision.axis.y * correction;
      if (!firstPitControlled) {
        first.x += firstCorrectionX;
        first.y += firstCorrectionY;
      }
      if (!secondPitControlled) {
        second.x += secondCorrectionX;
        second.y += secondCorrectionY;
      }

      if (oneCarFixed) {
        if (!firstPitControlled) first.speed = clamp(first.speed * 0.985, 0, VEHICLE_LIMITS.maxSpeed);
        if (!secondPitControlled) second.speed = clamp(second.speed * 0.985, 0, VEHICLE_LIMITS.maxSpeed);
      } else {
        applyContactVelocityResponse(sim, first, second, collision.axis);
      }

      const yawNudge = clamp(collision.depth * 0.0025, 0.008, 0.035);
      const freshContact = first.contactCooldown <= 0 && second.contactCooldown <= 0;
      const firstHeadingCorrection = firstPitControlled ? 0 : -collision.axis.y * yawNudge;
      const secondHeadingCorrection = secondPitControlled ? 0 : collision.axis.y * yawNudge;
      if (!firstPitControlled) {
        first.heading = normalizeAngle(first.heading + firstHeadingCorrection);
        shiftPreviousRenderPose(first, firstCorrectionX, firstCorrectionY, firstHeadingCorrection);
      }
      if (!secondPitControlled) {
        second.heading = normalizeAngle(second.heading + secondHeadingCorrection);
        shiftPreviousRenderPose(second, secondCorrectionX, secondCorrectionY, secondHeadingCorrection);
      }
      first.contactCooldown = 1;
      second.contactCooldown = 1;

      const contactKey = `${first.id}:${second.id}`;
      if (freshContact && pass === 0 && !reportedContacts.has(contactKey)) {
        reportedContacts.add(contactKey);
        sim.events.unshift({
          type: 'contact',
          at: sim.time,
          carId: first.id,
          otherCarId: second.id,
          firstShapeId: collision.firstShapeId,
          secondShapeId: collision.secondShapeId,
          contactType: collision.contactType,
          depth: collision.depth,
          timeOfImpact: collision.timeOfImpact,
        });
        sim.reviewCollision(first, second, stewardCollision);
      }
    }
  }
}

export function applyContactVelocityResponse(sim, first, second, axis) {
  const firstForward = forwardVector(first);
  const secondForward = forwardVector(second);
  const firstNormal = dot(firstForward, axis);
  const secondNormal = dot(secondForward, axis);
  const relativeNormalVelocity = second.speed * secondNormal - first.speed * firstNormal;

  if (relativeNormalVelocity < 0) {
    const impulse = clamp(-relativeNormalVelocity * (0.34 + sim.rules.collisionRestitution), 0, 16);
    if (firstNormal > 0) first.speed = clamp(first.speed - impulse * firstNormal, 0, VEHICLE_LIMITS.maxSpeed);
    if (secondNormal < 0) second.speed = clamp(second.speed + impulse * secondNormal, 0, VEHICLE_LIMITS.maxSpeed);
  }

  first.speed = clamp(first.speed * 0.997, 0, VEHICLE_LIMITS.maxSpeed);
  second.speed = clamp(second.speed * 0.997, 0, VEHICLE_LIMITS.maxSpeed);
}
