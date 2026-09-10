export function collectStepEvents(events = []) {
  return events.map((event) => normalizeEnvironmentEvent(event));
}

export function writeEventDriverIds(target, event) {
  target.length = 0;
  pushEventDriverId(target, event.driverId);
  pushEventDriverId(target, event.carId);
  pushEventDriverId(target, event.otherCarId);
  const extraDriverIds = event.driverIds ?? [];
  for (let index = 0; index < extraDriverIds.length; index += 1) {
    pushEventDriverId(target, extraDriverIds[index]);
  }
  return target;
}

function pushEventDriverId(target, driverId) {
  if (!driverId || target.includes(driverId)) return;
  target.push(driverId);
}

function normalizeEnvironmentEvent(event) {
  if (event.type === 'contact') {
    return {
      ...event,
      type: 'collision',
      driverIds: [event.carId, event.otherCarId].filter(Boolean),
      primaryDriverId: event.carId ?? null,
      otherDriverId: event.otherCarId ?? null,
      severity: event.severity ?? null,
    };
  }
  return { ...event };
}
