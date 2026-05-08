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
  if (state?.inPitLane) {
    return {
      nextState: { ...current, active: false },
      event: null,
      penalty: null,
    };
  }
  const trackLimit = track.width / 2;
  const relaxedMargin = (rule.relaxedMargin ?? 0) * (1 - rule.strictness);
  const side = Math.sign(state?.signedOffset ?? 0) || 1;
  const wheelStates = calculateWheelStates({ car, track });
  const outsideBy = calculateWholeCarOutsideMargin({ side, trackLimit, wheelStates });
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
      wheelOffsets: wheelStates.map((wheelState) => wheelState.signedOffset),
      reason: 'Exceeded track limits',
    },
  };
}

function calculateWheelStates({ car, track }) {
  const halfLength = VEHICLE_LIMITS.carLength / 2;
  const halfWidth = VEHICLE_LIMITS.carWidth / 2;
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  const forward = { x: cos, y: sin };
  const right = { x: -sin, y: cos };

  return [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].map(([longitudinalSide, lateralSide]) => {
    const longitudinal = {
      x: forward.x * halfLength * longitudinalSide,
      y: forward.y * halfLength * longitudinalSide,
    };
    const lateral = {
      x: right.x * halfWidth * lateralSide,
      y: right.y * halfWidth * lateralSide,
    };
    return nearestTrackState(track, {
      x: car.x + lateral.x + longitudinal.x,
      y: car.y + lateral.y + longitudinal.y,
    }, car.progress);
  });
}

function calculateWholeCarOutsideMargin({ side, trackLimit, wheelStates }) {
  if (side >= 0) {
    return Math.min(...wheelStates.map((wheelState) => wheelState.signedOffset)) - trackLimit;
  }
  return -trackLimit - Math.max(...wheelStates.map((wheelState) => wheelState.signedOffset));
}
