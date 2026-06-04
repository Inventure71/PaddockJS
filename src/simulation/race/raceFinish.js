import { isRaceDnf } from './retirements.js';

export function evaluateRaceFinishForSimulation(sim, orderedCars = sim.orderedCars()) {
  if (sim.raceControl.finished) return;
  if (sim.raceControl.mode === 'pre-start') return;

  const ordered = orderedCars;
  if (!ordered.length) return;

  let allFinishedOrDnf = true;
  let newlyFinishedCount = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const car = ordered[index];
    if (isRaceDnf(car) || car.finished) continue;
    if (car.raceDistance < sim.finishDistance) {
      allFinishedOrDnf = false;
      continue;
    }

    car.finished = true;
    car.finishTime = sim.time;
    car.finishRank = sim.raceControl.finishOrder.length + 1;
    car.classifiedRank = car.finishRank;
    sim.raceControl.finishOrder.push(car.id);
    if (!sim.raceControl.winnerId) sim.raceControl.winnerId = car.id;
    car.drsActive = false;
    car.drsEligible = false;
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car.canAttack = false;
    sim.events.unshift({
      type: 'car-finish',
      at: sim.time,
      carId: car.id,
      rank: car.finishRank,
      winnerId: sim.raceControl.winnerId,
    });
    sim.reviewTireRequirement(car);
    newlyFinishedCount += 1;
  }

  if (!allFinishedOrDnf) {
    if (!newlyFinishedCount && sim.runtimeBenchmarkStats) {
      sim.runtimeBenchmarkStats.finishEvalNoFinishFastPathCalls = (
        sim.runtimeBenchmarkStats.finishEvalNoFinishFastPathCalls ?? 0
      ) + 1;
    }
    return;
  }

  sim.applyOutstandingServicePenalties();
  const classification = sim.buildClassificationFromFinishOrder();
  const winningClassification = classification.find((entry) => !entry.dnf && entry.finished);
  sim.raceControl.winnerId = winningClassification?.id ?? null;
  sim.raceControl.mode = 'safety-car';
  sim.raceControl.finished = true;
  sim.raceControl.finishedAt = sim.time;
  sim.raceControl.classification = classification;
  sim.raceControl.frozenOrder = classification.map((entry) => entry.id);
  sim.safetyCar.deployed = true;
  const safetyCarLeader = sim.cars.find((car) => car.id === sim.raceControl.winnerId) ?? ordered[0];
  const safetyCarProgress = (safetyCarLeader?.raceDistance ?? 0) + sim.rules.safetyCarLeadDistance;
  if (sim.safetyCar.progress < safetyCarProgress) {
    sim.moveSafetyCarTo(safetyCarProgress);
  }
  sim.cars.forEach((car) => {
    const classified = classification.find((entry) => entry.id === car.id);
    car.classifiedRank = classified?.rank ?? null;
    car.desiredOffset = 0;
    car.drsActive = false;
    car.drsEligible = false;
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car.canAttack = false;
  });
  sim.events.unshift({
    type: 'race-finish',
    at: sim.time,
    winnerId: sim.raceControl.winnerId,
    classification: classification.map((entry) => ({ id: entry.id, rank: entry.rank })),
  });
}
