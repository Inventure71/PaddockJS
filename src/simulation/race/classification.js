import { clamp } from '../simMath.js';
import { simUnitsToMeters } from '../units.js';

function getPenaltyStats(statsByDriver, driverId) {
  return statsByDriver.get(driverId) ?? {
    seconds: 0,
    positionDrop: 0,
    disqualified: false,
  };
}

export function applyOutstandingServicePenalties(sim, applyUnservedServicePenalty) {
  sim.penalties.forEach((penalty) => {
    const beforeStatus = penalty.status;
    applyUnservedServicePenalty(penalty, sim.time);
    if (beforeStatus !== penalty.status && penalty.unserved) {
      sim.events.unshift({
        type: 'penalty-applied',
        at: sim.time,
        penaltyId: penalty.id,
        driverId: penalty.driverId,
        serviceType: penalty.serviceType,
        penaltySeconds: penalty.penaltySeconds,
      });
    }
  });
}

export function buildClassificationFromFinishOrder(sim) {
  const byId = new Map(sim.cars.map((car) => [car.id, car]));
  const penaltyStats = sim.getPenaltyStatsByDriver();
  const orderedByAdjustedTime = sim.raceControl.finishOrder
    .map((id, finishOrderIndex) => ({ car: byId.get(id), finishOrderIndex }))
    .filter((entry) => Boolean(entry.car))
    .sort((left, right) => {
      const leftTime = (left.car.finishTime ?? Infinity) + getPenaltyStats(penaltyStats, left.car.id).seconds;
      const rightTime = (right.car.finishTime ?? Infinity) + getPenaltyStats(penaltyStats, right.car.id).seconds;
      return leftTime === rightTime ? left.finishOrderIndex - right.finishOrderIndex : leftTime - rightTime;
    })
    .map((entry) => entry.car);
  const ordered = applyClassificationConsequences(sim, orderedByAdjustedTime, penaltyStats);
  return buildClassification(sim, ordered, penaltyStats);
}

export function applyClassificationConsequences(sim, ordered, penaltyStats = sim.getPenaltyStatsByDriver()) {
  const classified = ordered.filter((car) => !getPenaltyStats(penaltyStats, car.id).disqualified);
  ordered.forEach((car) => {
    const stats = getPenaltyStats(penaltyStats, car.id);
    if (stats.disqualified) return;
    const drop = stats.positionDrop;
    if (drop <= 0) return;
    const currentIndex = classified.findIndex((entry) => entry.id === car.id);
    if (currentIndex < 0) return;
    const [entry] = classified.splice(currentIndex, 1);
    classified.splice(Math.min(classified.length, currentIndex + drop), 0, entry);
  });
  return [
    ...classified,
    ...ordered.filter((car) => getPenaltyStats(penaltyStats, car.id).disqualified),
  ];
}

export function buildClassification(sim, ordered = sim.orderedCars(), penaltyStats = sim.getPenaltyStatsByDriver()) {
  const leaderDistance = ordered[0]?.raceDistance ?? 0;
  return ordered.map((car, index) => {
    const finishTime = car.finishTime ?? (car.raceDistance >= sim.finishDistance ? sim.time : null);
    const stats = getPenaltyStats(penaltyStats, car.id);
    const penaltySeconds = stats.seconds;
    const positionDrop = stats.positionDrop;
    const disqualified = stats.disqualified;
    return {
      id: car.id,
      code: car.code,
      timingCode: car.timingCode,
      name: car.name,
      rank: index + 1,
      raceDistance: car.raceDistance,
      distanceMeters: simUnitsToMeters(car.raceDistance),
      lap: sim.computeLap(car.raceDistance),
      lapsCompleted: clamp(Math.floor(Math.max(0, car.raceDistance) / sim.track.length), 0, sim.totalLaps),
      gapMeters: simUnitsToMeters(Math.max(0, leaderDistance - car.raceDistance)),
      gapSeconds: index === 0 ? 0 : car.leaderGapSeconds,
      intervalSeconds: index === 0 ? 0 : car.intervalAheadSeconds,
      gapLaps: index === 0 ? 0 : car.leaderGapLaps,
      intervalLaps: index === 0 ? 0 : car.intervalAheadLaps,
      finished: car.raceDistance >= sim.finishDistance,
      finishTime,
      penaltySeconds,
      adjustedFinishTime: finishTime == null ? null : finishTime + penaltySeconds,
      positionDrop,
      disqualified,
    };
  });
}

