import {
  buildCollisionCandidatePairs,
  collisionCandidatePairFirstIndex,
  collisionCandidatePairSecondIndex,
  detectVehicleCollision,
} from '../collisionGeometry.js';
import { canCollide, isCollidable } from '../participants/participantInteractions.js';
import { clamp, normalizeAngle } from '../simMath.js';
import { VEHICLE_LIMITS, isSimulatorPhysicsMode } from './vehiclePhysics.js';
import { shiftPreviousRenderPose } from '../pit/pitRouting.js';

const MAX_COLLISION_CORRECTION = 4.5;

function isPitPositionControlledCar(car) {
  const status = car?.pitStop?.status;
  return status === 'entering' || status === 'queued' || status === 'servicing' || status === 'exiting';
}

function velocityComponentX(car) {
  return Number.isFinite(car.velocityX) && Number.isFinite(car.velocityY)
    ? car.velocityX
    : Math.cos(car.heading) * car.speed;
}

function velocityComponentY(car) {
  return Number.isFinite(car.velocityX) && Number.isFinite(car.velocityY)
    ? car.velocityY
    : Math.sin(car.heading) * car.speed;
}

function applyVelocityScalars(car, velocityX, velocityY) {
  const rawSpeed = Math.hypot(velocityX, velocityY);
  const speed = clamp(rawSpeed, 0, VEHICLE_LIMITS.maxSpeed);
  if (speed <= 0) {
    car.velocityX = 0;
    car.velocityY = 0;
    car.speed = 0;
    return;
  }
  const scale = speed / Math.max(1e-9, rawSpeed);
  car.velocityX = velocityX * scale;
  car.velocityY = velocityY * scale;
  car.speed = speed;
}

function recordContactVelocityResponse(stats) {
  if (!stats) return;
  stats.contactVelocityResponses += 1;
  stats.contactVelocityVectorObjectAllocations += 0;
}

function prepareReportedContactMarks(scratch, carCount) {
  const requiredLength = Math.max(1, carCount * carCount);
  if (!(scratch.reportedContactMarks instanceof Uint32Array) || scratch.reportedContactMarks.length < requiredLength) {
    scratch.reportedContactMarks = new Uint32Array(requiredLength);
  }
  scratch.reportedContactEpoch = ((scratch.reportedContactEpoch ?? 0) + 1) >>> 0;
  if (scratch.reportedContactEpoch === 0) {
    scratch.reportedContactMarks.fill(0);
    scratch.reportedContactEpoch = 1;
  }
  return scratch.reportedContactMarks;
}

function contactMarkIndex(firstIndex, secondIndex, carCount) {
  const low = firstIndex < secondIndex ? firstIndex : secondIndex;
  const high = firstIndex < secondIndex ? secondIndex : firstIndex;
  return low * carCount + high;
}

export function resolveCollisionsForSimulation(sim) {
  sim.collisionScratch ??= {};
  const collidableCars = sim.collisionScratch.collidableCars ?? [];
  sim.collisionScratch.collidableCars = collidableCars;
  collidableCars.length = 0;
  for (let index = 0; index < sim.cars.length; index += 1) {
    const car = sim.cars[index];
    if (isCollidable(car)) collidableCars.push(car);
  }
  if (collidableCars.length < 2) return;
  const reportedContactMarks = prepareReportedContactMarks(sim.collisionScratch, collidableCars.length);
  const reportedContactEpoch = sim.collisionScratch.reportedContactEpoch;

  for (let pass = 0; pass < 3; pass += 1) {
    const candidates = buildCollisionCandidatePairs(collidableCars, {
      trackLength: sim.track.length,
      scratch: sim.collisionScratch,
    });
    for (const pair of candidates) {
      const [first, second] = pair;
      if (!canCollide(first, second)) continue;
      const collision = detectVehicleCollision(first, second, { scratch: sim.collisionScratch });
      if (!collision) continue;
      const firstPitControlled = isPitPositionControlledCar(first);
      const secondPitControlled = isPitPositionControlledCar(second);
      if (firstPitControlled && secondPitControlled) continue;
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
        if (!firstPitControlled) dampPitContactVelocity(first, 0.985, isSimulatorPhysicsMode(sim.physicsMode));
        if (!secondPitControlled) dampPitContactVelocity(second, 0.985, isSimulatorPhysicsMode(sim.physicsMode));
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

      const firstPairIndex = collisionCandidatePairFirstIndex(pair);
      const secondPairIndex = collisionCandidatePairSecondIndex(pair);
      const canMarkContact = firstPairIndex >= 0 && secondPairIndex >= 0;
      const contactIndex = canMarkContact
        ? contactMarkIndex(firstPairIndex, secondPairIndex, collidableCars.length)
        : -1;
      const alreadyReported = canMarkContact && reportedContactMarks[contactIndex] === reportedContactEpoch;
      if (freshContact && pass === 0 && !alreadyReported) {
        if (canMarkContact) reportedContactMarks[contactIndex] = reportedContactEpoch;
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
        sim.reviewCollision(first, second, collision, {
          scratch: sim.collisionScratch,
          trackLength: sim.track.length,
        });
      }
    }
  }
}

export function applyContactVelocityResponse(sim, first, second, axis, options = {}) {
  recordContactVelocityResponse(options.stats);
  if (
    isSimulatorPhysicsMode(sim.physicsMode) ||
    Number.isFinite(first.velocityX) ||
    Number.isFinite(second.velocityX)
  ) {
    let firstVelocityX = velocityComponentX(first);
    let firstVelocityY = velocityComponentY(first);
    let secondVelocityX = velocityComponentX(second);
    let secondVelocityY = velocityComponentY(second);
    const relativeNormalVelocity = (secondVelocityX - firstVelocityX) * axis.x +
      (secondVelocityY - firstVelocityY) * axis.y;

    if (relativeNormalVelocity < 0) {
      const impulse = clamp(-relativeNormalVelocity * (0.34 + sim.rules.collisionRestitution), 0, 16);
      firstVelocityX -= axis.x * impulse;
      firstVelocityY -= axis.y * impulse;
      secondVelocityX += axis.x * impulse;
      secondVelocityY += axis.y * impulse;
    }

    applyVelocityScalars(first, firstVelocityX * 0.997, firstVelocityY * 0.997);
    applyVelocityScalars(second, secondVelocityX * 0.997, secondVelocityY * 0.997);
    return;
  }

  const firstNormal = Math.cos(first.heading) * axis.x + Math.sin(first.heading) * axis.y;
  const secondNormal = Math.cos(second.heading) * axis.x + Math.sin(second.heading) * axis.y;
  const relativeNormalVelocity = second.speed * secondNormal - first.speed * firstNormal;

  if (relativeNormalVelocity < 0) {
    const impulse = clamp(-relativeNormalVelocity * (0.34 + sim.rules.collisionRestitution), 0, 16);
    if (firstNormal > 0) first.speed = clamp(first.speed - impulse * firstNormal, 0, VEHICLE_LIMITS.maxSpeed);
    if (secondNormal < 0) second.speed = clamp(second.speed + impulse * secondNormal, 0, VEHICLE_LIMITS.maxSpeed);
  }

  first.speed = clamp(first.speed * 0.997, 0, VEHICLE_LIMITS.maxSpeed);
  second.speed = clamp(second.speed * 0.997, 0, VEHICLE_LIMITS.maxSpeed);
}

function dampPitContactVelocity(car, factor, syncVelocity = false) {
  if (syncVelocity || Number.isFinite(car.velocityX) || Number.isFinite(car.velocityY)) {
    applyVelocityScalars(
      car,
      velocityComponentX(car) * factor,
      velocityComponentY(car) * factor,
    );
    return;
  }
  car.speed = clamp(car.speed * factor, 0, VEHICLE_LIMITS.maxSpeed);
}
