export function createPenaltyServedEvent(entry, time) {
  return {
    type: 'penalty-served',
    at: time,
    penaltyId: entry.id,
    driverId: entry.driverId,
    serviceType: entry.serviceType,
  };
}

export function createPenaltyCancelledEvent(entry, time) {
  return {
    type: 'penalty-cancelled',
    at: time,
    penaltyId: entry.id,
    driverId: entry.driverId,
  };
}
