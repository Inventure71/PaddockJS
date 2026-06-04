import { emitCollisionPenalties } from './collisionSteward.js';
import { calculateTireRequirementPenalty } from './tireRequirementSteward.js';
import { calculateTrackLimitReview } from './trackLimitsSteward.js';
import { calculatePitLaneSpeedingReview } from './pitLaneSpeedingSteward.js';
import { getPenaltyRule } from '../rulesConfig.js';
import { simSpeedToKph } from '../units.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';

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

function progressDelta(a, b, trackLength) {
  let delta = a - b;
  if (delta < -trackLength / 2) delta += trackLength;
  if (delta > trackLength / 2) delta -= trackLength;
  return delta;
}

function prepareCollisionStewardContext(scratch = null) {
  const target = scratch
    ? (scratch.collisionStewardContext ??= { sharedFaultDriverIds: [] })
    : { sharedFaultDriverIds: [] };
  target.sharedFaultDriverIds ??= [];
  return target;
}

function writeCollisionFacts(target, collision, trackLength) {
  target.depth = collision?.depth ?? 0;
  target.trackLength = trackLength ?? collision?.trackLength ?? null;
  target.firstShapeId = collision?.firstShapeId ?? null;
  target.secondShapeId = collision?.secondShapeId ?? null;
  target.contactType = collision?.contactType ?? null;
  target.timeOfImpact = collision?.timeOfImpact ?? null;
  target.swept = Boolean(collision?.swept);
  target.axis = collision?.axis ?? null;
  target.impactSpeed = 0;
  target.aheadDriverId = null;
  target.atFaultDriverId = null;
  target.sharedFault = false;
  target.sharedFaultDriverIds.length = 0;
  return target;
}

function writeCollisionStewardContext(target, first, second, collision, trackLength = null) {
  writeCollisionFacts(target, collision, trackLength);
  const distanceDelta = target.trackLength
    ? progressDelta(second.progress ?? second.raceDistance ?? 0, first.progress ?? first.raceDistance ?? 0, target.trackLength)
    : (second.raceDistance ?? 0) - (first.raceDistance ?? 0);
  const sideBySideTolerance = VEHICLE_LIMITS.carLength * 0.18;
  if (Math.abs(distanceDelta) <= sideBySideTolerance) {
    const relativeVelocityX = velocityComponentX(first) - velocityComponentX(second);
    const relativeVelocityY = velocityComponentY(first) - velocityComponentY(second);
    target.impactSpeed = Math.hypot(relativeVelocityX, relativeVelocityY);
    target.sharedFault = true;
    target.sharedFaultDriverIds[0] = first.id;
    target.sharedFaultDriverIds[1] = second.id;
    target.sharedFaultDriverIds.length = 2;
    return target;
  }

  const firstBehind = distanceDelta > 0;
  const behind = firstBehind ? first : second;
  const ahead = firstBehind ? second : first;
  const directionX = ahead.x - behind.x;
  const directionY = ahead.y - behind.y;
  const directionLength = Math.hypot(directionX, directionY) || 1;
  const normalX = directionX / directionLength;
  const normalY = directionY / directionLength;
  const relativeVelocityX = velocityComponentX(behind) - velocityComponentX(ahead);
  const relativeVelocityY = velocityComponentY(behind) - velocityComponentY(ahead);
  target.impactSpeed = Math.max(0, relativeVelocityX * normalX + relativeVelocityY * normalY);
  target.aheadDriverId = ahead.id;
  target.atFaultDriverId = behind.id;
  return target;
}

function isLegallyInsidePitLaneForTrackLimits(car) {
  if (!car.trackState?.inPitLane) return false;
  const wheels = car.wheelStates ?? [];
  return wheels.length > 0 && wheels.some((wheel) => wheel.inPitLane);
}

function recordPenaltyOnSimulation(penalty, sim) {
  sim.recordPenalty(penalty);
}

export function reviewCollisionForSimulation(sim, first, second, collision, options = {}) {
  const rule = getPenaltyRule(sim.rules, 'collision');
  const stats = options.stats ?? sim.runtimeBenchmarkStats ?? null;
  if (stats) stats.collisionStewardReviews = (stats.collisionStewardReviews ?? 0) + 1;
  const context = writeCollisionStewardContext(
    prepareCollisionStewardContext(options.scratch ?? null),
    first,
    second,
    collision,
    options.trackLength ?? null,
  );
  emitCollisionPenalties({
    first,
    second,
    collision: context,
    rule,
    emit: recordPenaltyOnSimulation,
    emitContext: sim,
  });
  if (stats) stats.collisionStewardPenaltyArrayAllocations = stats.collisionStewardPenaltyArrayAllocations ?? 0;
}

export function reviewTireRequirementForSimulation(sim, car) {
  const penalty = calculateTireRequirementPenalty({
    car,
    tireStrategy: sim.rules.modules?.tireStrategy,
    rule: getPenaltyRule(sim.rules, 'tireRequirement'),
  });
  if (penalty) sim.recordPenalty(penalty);
}

export function reviewTrackLimitsForSimulation(sim) {
  const rule = getPenaltyRule(sim.rules, 'trackLimits');
  sim.cars.forEach((car) => {
    if (isLegallyInsidePitLaneForTrackLimits(car)) {
      const current = sim.stewardState.trackLimits[car.id];
      sim.stewardState.trackLimits[car.id] = { ...(current ?? { violations: 0 }), active: false };
      return;
    }

    const currentState = sim.stewardState.trackLimits[car.id];
    const review = calculateTrackLimitReview({
      car,
      rule,
      track: sim.track,
      stewardState: currentState,
    });
    sim.stewardState.trackLimits[car.id] = review.nextState;
    if (review.event) sim.events.unshift({ ...review.event, at: sim.time });
    if (review.penalty) sim.recordPenalty(review.penalty);
  });
}

export function reviewPitLaneSpeedingForSimulation(sim) {
  const rule = getPenaltyRule(sim.rules, 'pitLaneSpeeding');
  sim.cars.forEach((car) => {
    const currentState = sim.stewardState.pitLaneSpeeding[car.id];
    const review = calculatePitLaneSpeedingReview({
      car: {
        ...car,
        speedKph: simSpeedToKph(car.speed),
      },
      rule,
      stewardState: currentState,
    });
    sim.stewardState.pitLaneSpeeding[car.id] = review.nextState;
    if (review.event) sim.events.unshift({ ...review.event, at: sim.time });
    if (review.penalty) sim.recordPenalty(review.penalty);
  });
}
