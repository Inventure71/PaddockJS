export function isRaceDnf(car) {
  return Boolean(car?.destroyed || car?.outOfRace);
}

export function getDnfOrder(car) {
  const order = Number(car?.dnfOrder);
  if (Number.isFinite(order)) return order;
  const retiredAt = Number(car?.dnfAt ?? car?.destroyedAt);
  if (Number.isFinite(retiredAt)) return retiredAt;
  return Infinity;
}

export function compareDnfOrder(left, right) {
  const orderDelta = getDnfOrder(left) - getDnfOrder(right);
  if (orderDelta !== 0) return orderDelta;
  const timeDelta = (left.dnfAt ?? left.destroyedAt ?? Infinity) - (right.dnfAt ?? right.destroyedAt ?? Infinity);
  if (timeDelta !== 0) return timeDelta;
  return (left.index ?? 0) - (right.index ?? 0);
}

export function nextDnfOrder(sim) {
  const current = Number(sim.raceControl?.nextDnfOrder);
  const next = Number.isFinite(current) ? current : 1;
  sim.raceControl.nextDnfOrder = next + 1;
  return next;
}

export function markCarDnf(sim, car, { reason = null } = {}) {
  if (!car || car.dnfOrder != null) return;
  car.dnfOrder = nextDnfOrder(sim);
  car.dnfAt = sim.time;
  car.dnfReason = reason ?? car.destroyReason ?? null;
}

export function clearCarDnf(car) {
  delete car.dnfOrder;
  delete car.dnfAt;
  delete car.dnfReason;
}

export function raceDnfCars(cars = []) {
  return cars.filter(isRaceDnf).sort(compareDnfOrder);
}
