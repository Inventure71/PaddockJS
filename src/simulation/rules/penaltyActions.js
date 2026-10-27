import { cancelPenaltyRecord, createPenaltyEvent, createPenaltyRecord, servePenaltyRecord } from './penaltyLedger.js';
import { createPenaltyCancelledEvent, createPenaltyServedEvent } from './penaltyEvents.js';

export function recordPenaltyForSimulation(sim, penalty) {
  const car = sim.cars.find((item) => item.id === penalty.driverId);
  const entry = createPenaltyRecord({
    sequence: sim.nextPenaltyId,
    time: sim.time,
    lap: sim.computeLap(car?.raceDistance ?? 0),
    penalty,
  });
  sim.nextPenaltyId += 1;
  sim.penalties.push(entry);
  if (entry.gridDrop > 0 && sim.raceControl.mode === 'pre-start') {
    sim.applyGridDrop(entry.driverId, entry.gridDrop);
  }
  sim.events.unshift(createPenaltyEvent(entry));
  return entry;
}

export function servePenaltyForSimulation(sim, penaltyId) {
  const penalty = sim.penalties.find((entry) => entry.id === penaltyId);
  const result = servePenaltyRecord(penalty, sim.time);
  if (result) {
    sim.events.unshift(createPenaltyServedEvent(result, sim.time));
  }
  return result;
}

export function cancelPenaltyForSimulation(sim, penaltyId) {
  const penalty = sim.penalties.find((entry) => entry.id === penaltyId);
  const result = cancelPenaltyRecord(penalty, sim.time);
  if (result) {
    sim.events.unshift(createPenaltyCancelledEvent(result, sim.time));
  }
  return result;
}
