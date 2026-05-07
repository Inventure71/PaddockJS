export function createPenaltyRecord({ sequence, time, lap, penalty }) {
  return {
    id: `penalty-${sequence}`,
    at: time,
    lap,
    ...penalty,
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
    strictness: entry.strictness,
  };
}

export function serializePenalty(penalty) {
  return { ...penalty };
}
