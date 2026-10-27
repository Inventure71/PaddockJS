export function initializeControlledPitIntent(host) {
  const sim = host.getSimulation?.();
  const options = host.getOptions?.();
  initializeControlledPitIntentForSimulation(sim, options);
}

export function initializeControlledPitIntentForSimulation(sim, options) {
  options?.controlledDrivers?.forEach?.((driverId) => {
    sim?.setAutomaticPitIntentEnabled?.(driverId, false);
    sim?.setPitIntent?.(driverId, 0);
    const car = sim?.cars?.find?.((item) => item.id === driverId);
    if (car) car.environmentControlled = true;
  });
}

function resetEnvironmentPitStop(car) {
  const stop = car?.pitStop;
  if (!stop) return;
  stop.status = 'pending';
  stop.phase = null;
  stop.intent = 0;
  stop.queueingForService = false;
  stop.route = null;
  stop.routeProgress = 0;
  stop.routeStartRaceDistance = null;
  stop.routeEndRaceDistance = null;
  stop.serviceRemaining = 0;
  stop.penaltyServiceRemaining = 0;
  stop.penaltyServiceTotal = 0;
  stop.servingPenaltyIds = [];
  stop.serviceProfile = null;
}

export function applyControlledRunoffResponse(sim, options) {
  options?.controlledDrivers?.forEach?.((driverId) => {
    const car = sim?.cars?.find?.((item) => item.id === driverId);
    if (car) sim?.applyRunoffResponse?.(car);
  });
}


export function resetControlledDriverState(sim, driverIds) {
  driverIds.forEach((driverId) => {
    sim.clearCarControls?.(driverId);
    sim.setAutomaticPitIntentEnabled?.(driverId, false);
    const car = sim.cars?.find?.((item) => item.id === driverId);
    resetEnvironmentPitStop(car);
    sim.setPitIntent?.(driverId, 0);
    if (car) sim.applyRunoffResponse?.(car);
  });
}
