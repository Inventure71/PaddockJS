import { clamp } from '../simMath.js';
import { affectsRaceOrder } from '../participants/participantInteractions.js';
import { distanceForward } from './raceDistance.js';
import { compareDnfOrder, isRaceDnf } from './retirements.js';

function canAppearInRaceOrder(car) {
  return car?.interaction?.affectsRaceOrder !== false;
}

function partitionRaceOrderParticipants(cars) {
  const live = [];
  const dnf = [];
  for (let index = 0; index < cars.length; index += 1) {
    const car = cars[index];
    if (!canAppearInRaceOrder(car)) continue;
    if (isRaceDnf(car)) dnf.push(car);
    else live.push(car);
  }
  dnf.sort(compareDnfOrder);
  return { live, dnf };
}

function sortLiveRaceOrderInPlace(cars) {
  cars.sort((a, b) => {
    const delta = b.raceDistance - a.raceDistance;
    return delta === 0 ? a.index - b.index : delta;
  });
  return cars;
}

function appendCars(target, source) {
  for (let index = 0; index < source.length; index += 1) {
    target.push(source[index]);
  }
  return target;
}

function collectLiveRaceOrderedCars(orderedCars, scratch) {
  const physicalCars = scratch?.physicalCars ?? [];
  physicalCars.length = 0;
  for (let index = 0; index < orderedCars.length; index += 1) {
    const car = orderedCars[index];
    if (!affectsRaceOrder(car) || isRaceDnf(car)) continue;
    physicalCars.push(car);
  }
  if (scratch) scratch.physicalCars = physicalCars;
  return physicalCars;
}

function sortPhysicalCarsInTrackOrder(sim, physicalCars) {
  physicalCars.sort((a, b) => {
    const progressDelta = (b.progress ?? b.raceDistance ?? 0) - (a.progress ?? a.raceDistance ?? 0);
    if (progressDelta !== 0) return progressDelta;
    const raceDistanceDelta = (b.raceDistance ?? 0) - (a.raceDistance ?? 0);
    return raceDistanceDelta === 0 ? a.index - b.index : raceDistanceDelta;
  });
  return physicalCars;
}

function canUseRaceOrderAsPhysicalOrder(sim, physicalCars) {
  if (physicalCars.length < 2) return true;
  const leaderDistance = physicalCars[0]?.raceDistance;
  const tailDistance = physicalCars[physicalCars.length - 1]?.raceDistance;
  return Number.isFinite(leaderDistance) &&
    Number.isFinite(tailDistance) &&
    leaderDistance - tailDistance < sim.track.length - 1e-6;
}

function buildFullFieldDrsReferenceArrayForSimulation(sim, orderedCars, references) {
  if (orderedCars.length !== sim.cars.length || !orderedCars.length) return false;
  let wrappedEligibleCar = null;
  for (let index = orderedCars.length - 1; index >= 0; index -= 1) {
    const car = orderedCars[index];
    if (!affectsRaceOrder(car) || isRaceDnf(car)) return false;
    if (!car.finished && !sim.isCarInActivePitStop(car) && wrappedEligibleCar == null) {
      wrappedEligibleCar = car;
    }
  }
  if (!canUseRaceOrderAsPhysicalOrder(sim, orderedCars)) return false;

  const trackLength = sim.track.length;
  let previousEligibleCar = wrappedEligibleCar;
  for (let index = 0; index < orderedCars.length; index += 1) {
    const car = orderedCars[index];
    const candidate = previousEligibleCar === car ? null : previousEligibleCar;
    if (candidate) {
      const delta = distanceForward(
        car.progress ?? car.raceDistance ?? 0,
        candidate.progress ?? candidate.raceDistance ?? 0,
        trackLength,
      );
      references[car.index] = delta > 0 && delta <= trackLength / 2 ? candidate : null;
    } else {
      references[car.index] = null;
    }
    if (!car.finished && !sim.isCarInActivePitStop(car)) previousEligibleCar = car;
  }
  return true;
}

function buildDrsReferenceArrayForSimulation(sim, orderedCars = orderedCarsForSimulation(sim)) {
  const scratch = sim._drsReferenceScratch ??= {};
  const references = scratch.references ?? [];
  references.length = sim.cars.length;
  if (buildFullFieldDrsReferenceArrayForSimulation(sim, orderedCars, references)) {
    scratch.references = references;
    if (sim?.runtimeBenchmarkStats) {
      sim.runtimeBenchmarkStats.drsReferenceScratchBuilds = (sim.runtimeBenchmarkStats.drsReferenceScratchBuilds ?? 0) + 1;
      sim.runtimeBenchmarkStats.drsReferenceFullFieldFastPathCalls = (sim.runtimeBenchmarkStats.drsReferenceFullFieldFastPathCalls ?? 0) + 1;
      sim.runtimeBenchmarkStats.drsReferenceOrderedFastPathCalls = (sim.runtimeBenchmarkStats.drsReferenceOrderedFastPathCalls ?? 0) + 1;
    }
    return references;
  }
  const physicalCars = collectLiveRaceOrderedCars(orderedCars, scratch);
  for (let index = 0; index < references.length; index += 1) {
    references[index] = null;
  }
  if (!physicalCars.length) return references;
  if (canUseRaceOrderAsPhysicalOrder(sim, physicalCars)) {
    if (sim?.runtimeBenchmarkStats) {
      sim.runtimeBenchmarkStats.drsReferenceOrderedFastPathCalls = (sim.runtimeBenchmarkStats.drsReferenceOrderedFastPathCalls ?? 0) + 1;
    }
  } else {
    sortPhysicalCarsInTrackOrder(sim, physicalCars);
  }

  const trackLength = sim.track.length;
  let wrappedEligibleCar = null;
  for (let index = physicalCars.length - 1; index >= 0; index -= 1) {
    const car = physicalCars[index];
    if (!car.finished && !sim.isCarInActivePitStop(car)) {
      wrappedEligibleCar = car;
      break;
    }
  }

  let previousEligibleCar = wrappedEligibleCar;
  for (let index = 0; index < physicalCars.length; index += 1) {
    const car = physicalCars[index];
    const candidate = previousEligibleCar === car ? null : previousEligibleCar;
    if (candidate) {
      const delta = distanceForward(
        car.progress ?? car.raceDistance ?? 0,
        candidate.progress ?? candidate.raceDistance ?? 0,
        trackLength,
      );
      references[car.index] = delta > 0 && delta <= trackLength / 2 ? candidate : null;
    } else {
      references[car.index] = null;
    }
    if (!car.finished && !sim.isCarInActivePitStop(car)) previousEligibleCar = car;
  }
  scratch.references = references;
  if (sim?.runtimeBenchmarkStats) {
    sim.runtimeBenchmarkStats.drsReferenceScratchBuilds = (sim.runtimeBenchmarkStats.drsReferenceScratchBuilds ?? 0) + 1;
  }
  return references;
}

export function orderedCarsForSimulation(sim) {
  const participants = partitionRaceOrderParticipants(sim.cars);
  const raceCars = participants.live;
  const dnfCars = participants.dnf;

  if (sim.raceControl.finished && sim.raceControl.classification?.length) {
    const byId = new Map(sim.cars.map((car) => [car.id, car]));
    const classified = sim.raceControl.classification.map((entry) => byId.get(entry.id)).filter(Boolean);
    const classifiedIds = new Set(classified.map((car) => car.id));
    return [
      ...classified,
      ...sortLiveRaceOrderInPlace(raceCars.filter((car) => !classifiedIds.has(car.id))),
      ...dnfCars.filter((car) => !classifiedIds.has(car.id)),
    ];
  }

  if (sim.raceControl.finishOrder?.length) {
    const byId = new Map(sim.cars.map((car) => [car.id, car]));
    const finished = sim.raceControl.finishOrder.map((id) => byId.get(id)).filter(Boolean);
    const finishedIds = new Set(finished.map((car) => car.id));
    const missedFinished = raceCars
      .filter((car) => car.finished && !finishedIds.has(car.id))
      .sort((a, b) => {
        const delta = (a.finishRank ?? Infinity) - (b.finishRank ?? Infinity);
        return delta === 0 ? a.index - b.index : delta;
      });
    const running = sortLiveRaceOrderInPlace(raceCars.filter((car) => !finishedIds.has(car.id) && !car.finished));
    return [...finished, ...missedFinished, ...running, ...dnfCars.filter((car) => !finishedIds.has(car.id))];
  }

  if (sim.safetyCar.deployed && sim.raceControl.frozenOrder?.length) {
    const byId = new Map(sim.cars.map((car) => [car.id, car]));
    const frozen = sim.raceControl.frozenOrder.map((id) => byId.get(id)).filter(Boolean);
    const activeFrozen = frozen.filter((car) => !isRaceDnf(car));
    const activeFrozenIds = new Set(activeFrozen.map((car) => car.id));
    return [
      ...activeFrozen,
      ...dnfCars.filter((car) => !activeFrozenIds.has(car.id)),
    ];
  }

  sortLiveRaceOrderInPlace(raceCars);
  return appendCars(raceCars, dnfCars);
}


export function raceOrderCarsForSimulation(sim) {
  return sim.cars.filter((car) => affectsRaceOrder(car) && !isRaceDnf(car));
}

export function driverRaceContextForSimulation(sim, orderedCars = orderedCarsForSimulation(sim)) {
  const raceCars = raceOrderCarsForSimulation(sim);
  return {
    physicsMode: sim.physicsMode,
    track: sim.track,
    cars: raceCars,
    orderedCars,
    safetyCar: sim.safetyCar,
    rules: sim.rules,
  };
}

export function buildDrsReferenceByCarId(sim, orderedCars = orderedCarsForSimulation(sim)) {
  const referencesByIndex = buildDrsReferenceArrayForSimulation(sim, orderedCars);
  const references = new Map();
  for (let index = 0; index < orderedCars.length; index += 1) {
    const car = orderedCars[index];
    if (!affectsRaceOrder(car) || isRaceDnf(car)) continue;
    references.set(car.id, referencesByIndex[car.index] ?? null);
  }
  return references;
}

export function assignDrsReferenceCarsForSimulation(sim, orderedCars = orderedCarsForSimulation(sim)) {
  return buildDrsReferenceArrayForSimulation(sim, orderedCars);
}

export function computeAggressionForSimulation(
  sim,
  car,
  orderIndex = Math.max(0, (car.rank ?? 1) - 1),
  fieldDepth = null,
) {
  const personality = car.personality ?? { baseAggression: 0.5, riskTolerance: 0.5, patience: 0.5 };
  if (sim.safetyCar.deployed || car.canAttack === false) {
    return clamp(personality.baseAggression * 0.62, 0.08, 0.62);
  }

  const resolvedFieldDepth = Number.isFinite(fieldDepth)
    ? Math.max(1, fieldDepth)
    : Math.max(1, raceOrderCarsForSimulation(sim).length - 1);
  const positionPressure = clamp(orderIndex / resolvedFieldDepth, 0, 1);
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
  if (!car) return null;
  return buildDrsReferenceArrayForSimulation(sim)[car.index] ?? null;
}
