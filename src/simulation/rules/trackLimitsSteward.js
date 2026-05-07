import { nearestTrackState } from '../trackModel.js';
import { VEHICLE_LIMITS } from '../vehiclePhysics.js';

export function calculateTrackLimitReview({ car, rule, track, stewardState }) {
  if (!rule) {
    return {
      nextState: stewardState ?? { active: false, violations: 0 },
      event: null,
      penalty: null,
    };
  }

  const state = car.trackState;
  const current = stewardState ?? { active: false, violations: 0 };
  const trackLimit = track.width / 2;
  const relaxedMargin = (rule.relaxedMargin ?? 0) * (1 - rule.strictness);
  const side = Math.sign(state?.signedOffset ?? 0) || 1;
  const outsideWheelStates = calculateOutsideWheelStates({ car, track, side });
  const outsideBy = calculateOutsideWheelMargin({ side, trackLimit, outsideWheelStates });
  const isViolation = outsideBy > relaxedMargin;

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
      wheelOffsets: outsideWheelStates.map((wheelState) => wheelState.signedOffset),
      reason: 'Exceeded track limits',
    },
  };
}

function calculateOutsideWheelStates({ car, track, side }) {
  const halfLength = VEHICLE_LIMITS.carLength / 2;
  const halfWidth = VEHICLE_LIMITS.carWidth / 2;
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  const forward = { x: cos, y: sin };
  const right = { x: -sin, y: cos };
  const lateral = {
    x: right.x * halfWidth * side,
    y: right.y * halfWidth * side,
  };

  return [-0.5, 0.5].map((longitudinalSide) => {
    const longitudinal = {
      x: forward.x * halfLength * longitudinalSide,
      y: forward.y * halfLength * longitudinalSide,
    };
    return nearestTrackState(track, {
      x: car.x + lateral.x + longitudinal.x,
      y: car.y + lateral.y + longitudinal.y,
    }, car.progress);
  });
}

function calculateOutsideWheelMargin({ side, trackLimit, outsideWheelStates }) {
  if (side >= 0) {
    return Math.min(...outsideWheelStates.map((wheelState) => wheelState.signedOffset)) - trackLimit;
  }
  return -trackLimit - Math.max(...outsideWheelStates.map((wheelState) => wheelState.signedOffset));
}
