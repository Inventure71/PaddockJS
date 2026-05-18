import { isPenaltyActive } from './penaltyLedger.js';

export function createEmptyPenaltyStats() {
  return {
    seconds: 0,
    positionDrop: 0,
    disqualified: false,
  };
}

export function getPenaltyStats(statsByDriver, driverId) {
  return statsByDriver.get(driverId) ?? createEmptyPenaltyStats();
}

export function buildPenaltyStatsByDriver(penalties = []) {
  const byDriver = new Map();
  penalties.forEach((penalty) => {
    if (!penalty?.driverId || !isPenaltyActive(penalty)) return;
    const stats = byDriver.get(penalty.driverId) ?? createEmptyPenaltyStats();
    stats.seconds += Number(penalty.penaltySeconds) || 0;
    stats.positionDrop += Number(penalty.positionDrop) || 0;
    stats.disqualified = stats.disqualified || Boolean(penalty.disqualified);
    byDriver.set(penalty.driverId, stats);
  });
  return byDriver;
}
