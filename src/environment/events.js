export function collectStepEvents(events = []) {
  return events.map((event) => normalizeEnvironmentEvent(event));
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
