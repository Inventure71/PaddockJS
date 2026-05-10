import { clamp } from '../simMath.js';
import { distanceForward } from './raceDistance.js';

export function orderedCarsForSimulation(sim) {
  const sortLive = (cars) => [...cars].sort((a, b) => {
    const delta = b.raceDistance - a.raceDistance;
    return delta === 0 ? a.index - b.index : delta;
  });
  const byId = new Map(sim.cars.map((car) => [car.id, car]));

  if (sim.raceControl.finished && sim.raceControl.classification?.length) {
    const classified = sim.raceControl.classification.map((entry) => byId.get(entry.id)).filter(Boolean);
    const classifiedIds = new Set(classified.map((car) => car.id));
    return [
      ...classified,
      ...sortLive(sim.cars.filter((car) => !classifiedIds.has(car.id))),
    ];
  }

  if (sim.raceControl.finishOrder?.length) {
    const finished = sim.raceControl.finishOrder.map((id) => byId.get(id)).filter(Boolean);
    const finishedIds = new Set(finished.map((car) => car.id));
    const missedFinished = sim.cars
      .filter((car) => car.finished && !finishedIds.has(car.id))
      .sort((a, b) => {
        const delta = (a.finishRank ?? Infinity) - (b.finishRank ?? Infinity);
        return delta === 0 ? a.index - b.index : delta;
      });
    const running = sortLive(sim.cars.filter((car) => !finishedIds.has(car.id) && !car.finished));
    return [...finished, ...missedFinished, ...running];
  }

  if (sim.safetyCar.deployed && sim.raceControl.frozenOrder?.length) {
    return sim.raceControl.frozenOrder.map((id) => byId.get(id)).filter(Boolean);
  }

  return sortLive(sim.cars);
}

export function driverRaceContextForSimulation(sim, orderedCars = orderedCarsForSimulation(sim)) {
  return {
    track: sim.track,
    cars: sim.cars,
    orderedCars,
    safetyCar: sim.safetyCar,
    rules: sim.rules,
  };
}

export function computeAggressionForSimulation(sim, car, orderIndex = Math.max(0, (car.rank ?? 1) - 1)) {
  const personality = car.personality ?? { baseAggression: 0.5, riskTolerance: 0.5, patience: 0.5 };
  if (sim.safetyCar.deployed || car.canAttack === false) {
    return clamp(personality.baseAggression * 0.62, 0.08, 0.62);
  }

  const fieldDepth = Math.max(1, sim.cars.length - 1);
  const positionPressure = clamp(orderIndex / fieldDepth, 0, 1);
  const gapPressure = Number.isFinite(car.gapAhead) ? clamp((230 - car.gapAhead) / 230, 0, 1) : 0;
  const tireConfidence = clamp(((car.tireEnergy ?? 100) - 42) / 58, 0, 1);
  const patienceDamping = (1 - gapPressure) * personality.patience * 0.08;

  return clamp(
    personality.baseAggression
      + positionPressure * 0.26
      + gapPressure * (0.1 + personality.riskTolerance * 0.08)
      - (1 - tireConfidence) * 0.1
      - patienceDamping,
    0.08,
    1,
  );
}

export function getDrsReferenceCarForSimulation(sim, car) {
  let closest = null;
  sim.cars.forEach((candidate) => {
    if (candidate === car || candidate.finished || sim.isCarInActivePitStop(candidate)) return;
    const delta = distanceForward(
      car.progress ?? car.raceDistance ?? 0,
      candidate.progress ?? candidate.raceDistance ?? 0,
      sim.track.length,
    );
    if (delta <= 0 || delta > sim.track.length / 2) return;
    if (!closest || delta < closest.delta) closest = { car: candidate, delta };
  });
  return closest?.car ?? null;
}
