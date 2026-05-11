import { pointAt } from '../track/trackModel.js';

export function createRaceControlState(rules, startLightsOutAt) {
  return {
    mode: rules.standingStart === false ? 'green' : 'pre-start',
    frozenOrder: null,
    redFlag: false,
    pitLaneOpen: true,
    finished: false,
    finishedAt: null,
    winnerId: null,
    classification: [],
    finishOrder: [],
    nextDnfOrder: 1,
    start: {
      lightCount: rules.startLightCount,
      lightsLit: 0,
      lightsOutAt: startLightsOutAt,
      released: rules.standingStart === false,
      releasedAt: rules.standingStart === false ? 0 : null,
    },
  };
}

export function createSafetyCarState(track, rules) {
  const safetyCarStart = pointAt(track, rules.safetyCarLeadDistance);
  return {
    deployed: false,
    progress: rules.safetyCarLeadDistance,
    speed: rules.safetyCarSpeed,
    previousX: safetyCarStart.x,
    previousY: safetyCarStart.y,
    previousHeading: safetyCarStart.heading,
    x: safetyCarStart.x,
    y: safetyCarStart.y,
    heading: safetyCarStart.heading,
  };
}
