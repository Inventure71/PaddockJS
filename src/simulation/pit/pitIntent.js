export function firstDifferentCompound(currentTire, compounds) {
  const available = Array.isArray(compounds) && compounds.length ? compounds : ['S', 'M', 'H'];
  return available.find((compound) => compound !== currentTire) ?? currentTire;
}

export function normalizePitCompound(value, compounds) {
  if (value == null || value === '') return null;
  const available = Array.isArray(compounds) && compounds.length ? compounds : ['S', 'M', 'H'];
  return available.includes(value) ? value : null;
}

export function normalizePitIntent(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 2) return null;
  return number;
}

export function setPitIntentForSimulation(sim, id, intent, targetCompound = undefined) {
  const request = intent && typeof intent === 'object'
    ? intent
    : { intent, targetCompound };
  const nextIntent = normalizePitIntent(request.intent ?? request.pitIntent);
  if (nextIntent == null) return false;
  const car = sim.cars.find((item) => item.id === id);
  const stop = car?.pitStop;
  const pitStops = sim.rules.modules?.pitStops;
  if (!car || !stop || !pitStops?.enabled || !sim.track.pitLane?.enabled) return false;
  if (sim.isCarInActivePitStop(car)) return false;

  const compoundRequest = request.targetCompound ??
    request.compound ??
    request.pitCompound ??
    request.pitTargetCompound ??
    request.targetTire;
  const hasCompoundRequest = compoundRequest != null && compoundRequest !== '';
  if (hasCompoundRequest) {
    const targetTire = normalizePitCompound(compoundRequest, sim.rules.modules?.tireStrategy?.compounds);
    if (!targetTire) return false;
    stop.targetTire = targetTire;
  } else if (nextIntent !== 0 && (!stop.targetTire || stop.status === 'completed')) {
    stop.targetTire = firstDifferentCompound(car.tire, sim.rules.modules?.tireStrategy?.compounds);
  } else if (nextIntent === 0) {
    stop.targetTire = firstDifferentCompound(car.tire, sim.rules.modules?.tireStrategy?.compounds);
  }

  stop.intent = nextIntent;
  if (stop.status === 'pending' && nextIntent !== 0) {
    sim.schedulePitStopAtNextEntry(car, stop);
  } else if (stop.status === 'completed' && nextIntent !== 0) {
    sim.rearmCompletedPitStop(car, stop);
  }
  return true;
}

export function shouldStartPitStopForSimulation(sim, car) {
  const stop = car.pitStop;
  if (!stop || stop.status !== 'pending' || car.finished) return false;
  if (!sim.isPitLaneOpenForStops()) return false;
  const intent = normalizePitIntent(stop.intent) ?? 0;
  if (intent === 0) return false;
  const raceDistance = car.raceDistance ?? 0;
  if (raceDistance > stop.entryRaceDistance + sim.pitEntryLateThresholdDistance()) {
    sim.schedulePitStopAtNextEntry(car, stop);
    return false;
  }
  return raceDistance >= stop.plannedRaceDistance &&
    (intent === 2 || sim.canStartPitStop(car));
}

export function updateAutomaticPitIntentForSimulation(sim, car) {
  const stop = car.pitStop;
  const pitStops = sim.rules.modules?.pitStops;
  if (!stop || !['pending', 'completed'].includes(stop.status) || !pitStops?.enabled || car.finished) return;
  if (car.automaticPitIntentEnabled === false) return;
  const tireEnergy = Number(car.tireEnergy ?? 100);
  const requestThreshold = Number(pitStops.tirePitRequestThresholdPercent ?? 50);
  const commitThreshold = Number(pitStops.tirePitCommitThresholdPercent ?? 30);
  if (!Number.isFinite(tireEnergy)) return;

  let nextIntent = 0;
  if (tireEnergy < commitThreshold) nextIntent = 2;
  else if (tireEnergy < requestThreshold) nextIntent = 1;
  if (nextIntent === 0 || nextIntent <= (normalizePitIntent(stop.intent) ?? 0)) return;

  stop.intent = nextIntent;
  if (stop.status === 'completed') sim.rearmCompletedPitStop(car, stop);
  else sim.schedulePitStopAtNextEntry(car, stop);
}
