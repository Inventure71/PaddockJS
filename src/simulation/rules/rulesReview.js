import { calculateCollisionPenalties } from './collisionSteward.js';
import { calculateTireRequirementPenalty } from './tireRequirementSteward.js';
import { calculateTrackLimitReview } from './trackLimitsSteward.js';
import { calculatePitLaneSpeedingReview } from './pitLaneSpeedingSteward.js';
import { getPenaltyRule } from '../rulesConfig.js';
import { simSpeedToKph } from '../units.js';
import { VEHICLE_LIMITS } from '../vehiclePhysics.js';

function forwardVector(car) {
  return { x: Math.cos(car.heading), y: Math.sin(car.heading) };
}

function velocityVector(car) {
  const forward = forwardVector(car);
  return { x: forward.x * car.speed, y: forward.y * car.speed };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function progressDelta(a, b, trackLength) {
  let delta = a - b;
  if (delta < -trackLength / 2) delta += trackLength;
  if (delta > trackLength / 2) delta -= trackLength;
  return delta;
}

function createCollisionStewardContext(first, second, collision) {
  const distanceDelta = collision.trackLength
    ? progressDelta(second.progress ?? second.raceDistance ?? 0, first.progress ?? first.raceDistance ?? 0, collision.trackLength)
    : (second.raceDistance ?? 0) - (first.raceDistance ?? 0);
  const sideBySideTolerance = VEHICLE_LIMITS.carLength * 0.18;
  if (Math.abs(distanceDelta) <= sideBySideTolerance) {
    const firstVelocity = velocityVector(first);
    const secondVelocity = velocityVector(second);
    const relativeVelocity = {
      x: firstVelocity.x - secondVelocity.x,
      y: firstVelocity.y - secondVelocity.y,
    };
    return {
      ...collision,
      impactSpeed: Math.hypot(relativeVelocity.x, relativeVelocity.y),
      aheadDriverId: null,
      atFaultDriverId: null,
      sharedFault: true,
      sharedFaultDriverIds: [first.id, second.id],
    };
  }

  const firstBehind = distanceDelta > 0;
  const behind = firstBehind ? first : second;
  const ahead = firstBehind ? second : first;
  const directionBehindToAhead = normalizeVector({
    x: ahead.x - behind.x,
    y: ahead.y - behind.y,
  });
  const behindVelocity = velocityVector(behind);
  const aheadVelocity = velocityVector(ahead);
  const relativeVelocity = {
    x: behindVelocity.x - aheadVelocity.x,
    y: behindVelocity.y - aheadVelocity.y,
  };

  return {
    ...collision,
    impactSpeed: Math.max(0, dot(relativeVelocity, directionBehindToAhead)),
    aheadDriverId: ahead.id,
    atFaultDriverId: behind.id,
  };
}

function isLegallyInsidePitLaneForTrackLimits(car) {
  if (!car.trackState?.inPitLane) return false;
  const wheels = car.wheelStates ?? [];
  return wheels.length > 0 && wheels.some((wheel) => wheel.inPitLane);
}

export function reviewCollisionForSimulation(sim, first, second, collision) {
  const rule = getPenaltyRule(sim.rules, 'collision');
  calculateCollisionPenalties({
    first,
    second,
    collision: createCollisionStewardContext(first, second, collision),
    rule,
  }).forEach((penalty) => sim.recordPenalty(penalty));
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
