import { isRaceDnf } from './retirements.js';

export function evaluateRaceFinishForSimulation(sim) {
  if (sim.raceControl.finished) return;
  if (sim.raceControl.mode === 'pre-start') return;

  const ordered = sim.orderedCars();
  const newlyFinished = ordered.filter((car) => !isRaceDnf(car) && !car.finished && car.raceDistance >= sim.finishDistance);

  newlyFinished.forEach((car) => {
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
  });

  if (!ordered.length || !ordered.every((car) => car.finished || isRaceDnf(car))) return;

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
  const leader = sim.cars.find((car) => car.id === sim.raceControl.winnerId) ?? ordered[0];
  const safetyCarProgress = (leader?.raceDistance ?? 0) + sim.rules.safetyCarLeadDistance;
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
