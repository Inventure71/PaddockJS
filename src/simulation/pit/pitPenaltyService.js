import {
  getPitServicePenaltySeconds,
  isPenaltyPitServiceable,
  servePitPenaltyRecord,
} from '../rules/penaltyLedger.js';
import { beginTireService } from './pitTireService.js';

export function beginPitPenaltyService(sim, car) {
  const stop = car.pitStop;
  const penalties = getPitServicePenalties(sim, car.id);
  if (!stop || !penalties.length) return false;

  const totalSeconds = penalties.reduce((total, penalty) => (
    total + getPitServicePenaltySeconds(penalty)
  ), 0);
  stop.servingPenaltyIds = penalties.map((penalty) => penalty.id);
  stop.penaltyServiceTotal = totalSeconds;
  stop.penaltyServiceRemaining = totalSeconds;

  if (totalSeconds <= 0) {
    completePitPenaltyService(sim, car);
    return true;
  }

  stop.phase = 'penalty';
  stop.serviceRemaining = totalSeconds;
  sim.events.unshift({
    type: 'pit-penalty-service-start',
    at: sim.time,
    carId: car.id,
    penaltyIds: [...stop.servingPenaltyIds],
    penaltyServiceSeconds: totalSeconds,
  });
  return true;
}

export function completePitPenaltyService(sim, car) {
  const stop = car.pitStop;
  if (!stop) return;
  const servedIds = [...(stop.servingPenaltyIds ?? [])];
  servedIds.forEach((penaltyId) => {
    const penalty = sim.penalties.find((entry) => entry.id === penaltyId);
    const beforeStatus = penalty?.status;
    const result = servePitPenaltyRecord(penalty, sim.time);
    if (result && beforeStatus !== result.status) {
      sim.events.unshift({
        type: 'penalty-served',
        at: sim.time,
        penaltyId: result.id,
        driverId: result.driverId,
        serviceType: result.serviceType,
        serviceContext: 'pit-stop',
      });
    }
  });
  stop.penaltyServiceRemaining = 0;
  stop.serviceRemaining = 0;
  sim.events.unshift({
    type: 'pit-penalty-service-complete',
    at: sim.time,
    carId: car.id,
    penaltyIds: servedIds,
  });
  beginTireService(sim, car);
}

export function getPitServicePenalties(sim, driverId) {
  return sim.penalties.filter((penalty) => (
    penalty.driverId === driverId && isPenaltyPitServiceable(penalty)
  ));
}
