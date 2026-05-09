const SPEED_LIMITED_PIT_PARTS = new Set(['fast-lane', 'working-lane', 'service-box', 'garage-box']);

export function calculatePitLaneSpeedingReview({ car, rule, stewardState }) {
  const current = stewardState ?? { active: false, violations: 0 };
  if (!rule) {
    return {
      nextState: current,
      event: null,
      penalty: null,
    };
  }

  const speedKph = Number(car.speedKph);
  const pitLanePart = car.trackState?.pitLanePart ?? car.pitLanePart;
  const inLimitedPitLane = Boolean(car.trackState?.inPitLane) && SPEED_LIMITED_PIT_PARTS.has(pitLanePart);
  const marginKph = (Number(rule.marginKph) || 0) + ((Number(rule.relaxedMarginKph) || 0) * (1 - rule.strictness));
  const speedLimitKph = Number(rule.speedLimitKph) || 80;
  const excessKph = speedKph - speedLimitKph;
  const isViolation = inLimitedPitLane && excessKph > marginKph;

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
    type: 'pit-lane-speeding',
    carId: car.id,
    violationCount,
    speedKph,
    speedLimitKph,
    excessKph,
    pitLanePart,
    strictness: rule.strictness,
  };

  return {
    nextState,
    event,
    penalty: {
      type: 'pit-lane-speeding',
      driverId: car.id,
      strictness: rule.strictness,
      penaltySeconds: rule.timePenaltySeconds,
      consequences: rule.consequences,
      violationCount,
      speedKph,
      speedLimitKph,
      excessKph,
      marginKph,
      pitLanePart,
      reason: 'Exceeded pit lane speed limit',
    },
  };
}
