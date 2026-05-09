import { calculateWheelSurfaceState, isWholeCarOutsideTrackLimits } from '../wheelSurface.js';
import { metersToSimUnits } from '../units.js';

const STEWARD_TRACK_LIMIT_EPSILON = metersToSimUnits(0.2);

export function calculateTrackLimitReview({ car, rule, track, stewardState }) {
  if (!rule) {
    return {
      nextState: stewardState ?? { active: false, violations: 0 },
      event: null,
      penalty: null,
    };
  }

  const current = stewardState ?? { active: false, violations: 0 };
  const wheelSurfaceState = car.wheelStates?.length
    ? {
        wheels: car.wheelStates,
        trackLimits: isWholeCarOutsideTrackLimits(car.wheelStates, track),
      }
    : calculateWheelSurfaceState({ car, track });
  const wheelStates = wheelSurfaceState.wheels;
  if (wheelStates.some((wheelState) => wheelState.inPitLane)) {
    return {
      nextState: { ...current, active: false },
      event: null,
      penalty: null,
    };
  }
  const relaxedMargin = ((rule.relaxedMargin ?? 0) * (1 - rule.strictness)) + STEWARD_TRACK_LIMIT_EPSILON;
  const trackLimitState = isWholeCarOutsideTrackLimits(wheelStates, track, relaxedMargin);
  const outsideBy = trackLimitState.outsideBy;
  const isViolation = trackLimitState.violating;

  if (!isViolation) {
    return {
      nextState: { ...current, active: false },
      event: null,
      penalty: null,
    };
  }

  if (current.active) {
    return {
      nextState: current,
      event: null,
      penalty: null,
    };
  }

  const violationCount = current.violations + 1;
  const nextState = {
    active: true,
    violations: violationCount,
  };
  const event = {
    type: 'track-limits',
    carId: car.id,
    violationCount,
    warningsBeforePenalty: rule.warningsBeforePenalty,
    decision: violationCount <= rule.warningsBeforePenalty ? 'warning' : 'penalty',
    strictness: rule.strictness,
  };

  if (violationCount <= rule.warningsBeforePenalty) {
    return { nextState, event, penalty: null };
  }

  return {
    nextState,
    event,
    penalty: {
      type: 'track-limits',
      driverId: car.id,
      strictness: rule.strictness,
      penaltySeconds: rule.timePenaltySeconds,
      consequences: rule.consequences,
      violationCount,
      margin: relaxedMargin,
      outsideBy,
      wheelOffsets: wheelStates.map((wheelState) => wheelState.signedOffset),
      reason: 'Exceeded track limits',
    },
  };
}
