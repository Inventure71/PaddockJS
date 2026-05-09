const DEFAULT_SERVICE_CONVERSION_SECONDS = {
  driveThrough: 20,
  stopGo: 30,
};

export function createPenaltyRecord({ sequence, time, lap, penalty }) {
  const consequences = normalizePenaltyConsequences(penalty.consequences, penalty.penaltySeconds);
  const immediatePenaltySeconds = sumTimeConsequences(consequences);
  const serviceConsequence = consequences.find((consequence) => (
    consequence.type === 'driveThrough' || consequence.type === 'stopGo'
  ));
  const status = penalty.status ?? (serviceConsequence ? 'issued' : 'applied');

  return {
    id: `penalty-${sequence}`,
    at: time,
    lap,
    ...penalty,
    status,
    consequences,
    penaltySeconds: Number.isFinite(Number(penalty.penaltySeconds))
      ? Number(penalty.penaltySeconds)
      : immediatePenaltySeconds,
    pendingPenaltySeconds: serviceConsequence
      ? serviceConversionSeconds(serviceConsequence)
      : 0,
    serviceType: serviceConsequence?.type ?? null,
    serviceRequired: Boolean(serviceConsequence),
    serviceServedAt: null,
    unserved: false,
    positionDrop: sumPositionDropConsequences(consequences),
    gridDrop: sumGridDropConsequences(consequences),
    disqualified: consequences.some((consequence) => consequence.type === 'disqualification'),
  };
}

export function createPenaltyEvent(entry) {
  return {
    type: 'penalty',
    at: entry.at,
    penaltyId: entry.id,
    penaltyType: entry.type,
    driverId: entry.driverId,
    penaltySeconds: entry.penaltySeconds,
    status: entry.status,
    strictness: entry.strictness,
  };
}

export function serializePenalty(penalty) {
  return { ...penalty };
}

export function servePenaltyRecord(penalty, time) {
  if (!penalty || penalty.status === 'cancelled') return penalty;
  if (!penalty.serviceRequired) return penalty;
  penalty.status = 'served';
  penalty.serviceServedAt = time;
  penalty.unserved = false;
  return penalty;
}

export function getPitServicePenaltySeconds(penalty) {
  if (!penalty || penalty.status === 'cancelled' || penalty.status === 'served') return 0;
  if (penalty.serviceRequired && penalty.status === 'issued') {
    if (penalty.serviceType === 'stopGo') return sumStopGoServiceSeconds(penalty.consequences);
    if (penalty.serviceType === 'driveThrough') return 0;
  }
  if (!penalty.serviceRequired && penalty.status === 'applied') {
    return sumTimeConsequences(penalty.consequences);
  }
  return 0;
}

export function isPenaltyPitServiceable(penalty) {
  if (!penalty || penalty.status === 'cancelled' || penalty.status === 'served') return false;
  if (penalty.serviceRequired && penalty.status === 'issued') return true;
  return !penalty.serviceRequired &&
    penalty.status === 'applied' &&
    getPitServicePenaltySeconds(penalty) > 0;
}

export function servePitPenaltyRecord(penalty, time) {
  if (!isPenaltyPitServiceable(penalty)) return penalty;
  penalty.status = 'served';
  penalty.serviceServedAt = time;
  penalty.unserved = false;
  penalty.penaltySeconds = 0;
  penalty.pendingPenaltySeconds = 0;
  return penalty;
}

export function cancelPenaltyRecord(penalty, time) {
  if (!penalty) return penalty;
  penalty.status = 'cancelled';
  penalty.cancelledAt = time;
  penalty.penaltySeconds = 0;
  penalty.pendingPenaltySeconds = 0;
  penalty.positionDrop = 0;
  penalty.gridDrop = 0;
  penalty.disqualified = false;
  penalty.unserved = false;
  return penalty;
}

export function applyUnservedServicePenalty(penalty, time) {
  if (!penalty || penalty.status !== 'issued' || !penalty.serviceRequired) return penalty;
  penalty.status = 'applied';
  penalty.appliedAt = time;
  penalty.unserved = true;
  penalty.penaltySeconds += penalty.pendingPenaltySeconds;
  return penalty;
}

export function isPenaltyActive(penalty) {
  return penalty?.status !== 'cancelled';
}

function normalizePenaltyConsequences(consequences, fallbackSeconds = 0) {
  if (Array.isArray(consequences) && consequences.length) return consequences.map((consequence) => ({ ...consequence }));
  const seconds = Number(fallbackSeconds) || 0;
  return seconds > 0 ? [{ type: 'time', seconds }] : [];
}

function sumTimeConsequences(consequences) {
  return consequences.reduce((total, consequence) => (
    consequence.type === 'time' ? total + (Number(consequence.seconds) || 0) : total
  ), 0);
}

function sumStopGoServiceSeconds(consequences) {
  return consequences.reduce((total, consequence) => (
    consequence.type === 'stopGo' ? total + (Number(consequence.seconds) || 0) : total
  ), 0);
}

function sumPositionDropConsequences(consequences) {
  return consequences.reduce((total, consequence) => (
    consequence.type === 'positionDrop' ? total + Math.max(0, Math.floor(Number(consequence.positions) || 0)) : total
  ), 0);
}

function sumGridDropConsequences(consequences) {
  return consequences.reduce((total, consequence) => (
    consequence.type === 'gridDrop' ? total + Math.max(0, Math.floor(Number(consequence.positions) || 0)) : total
  ), 0);
}

function serviceConversionSeconds(consequence) {
  return Number.isFinite(Number(consequence.conversionSeconds))
    ? Math.max(0, Number(consequence.conversionSeconds))
    : DEFAULT_SERVICE_CONVERSION_SECONDS[consequence.type] ?? 0;
}
