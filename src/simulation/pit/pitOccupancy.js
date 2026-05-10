import { PIT_SERVICE_CLEAR_DISTANCE, pointDistance } from './pitServiceConstants.js';

export function getPitStopBox(sim, stop) {
  return sim.track.pitLane?.serviceAreas?.find((box) => box.id === stop?.boxId) ??
    sim.track.pitLane?.boxes?.find((box) => box.id === stop?.boxId) ??
    null;
}

export function isPitServiceAreaOccupied(sim, candidate, box, clearDistance) {
  const status = candidate?.pitStop?.status;
  const phase = candidate?.pitStop?.phase;
  if (!status || !box) return false;
  if (status === 'servicing') return true;
  if (status === 'entering' && phase === 'queue-release') return true;
  if (status === 'exiting') return pointDistance(candidate, box.center) < clearDistance;
  return false;
}

export function isPitServiceBusy(sim, car, box, clearDistance = PIT_SERVICE_CLEAR_DISTANCE) {
  return sim.cars.some((candidate) => (
    candidate !== car &&
    candidate.pitStop?.boxId === box?.id &&
    isPitServiceAreaOccupied(sim, candidate, box, clearDistance)
  ));
}

export function isPitServiceQueueOccupied(sim, car, box) {
  return sim.cars.some((candidate) => (
    candidate !== car &&
    candidate.pitStop?.boxId === box?.id &&
    (
      candidate.pitStop?.status === 'queued' ||
      Boolean(candidate.pitStop?.queueingForService)
    )
  ));
}

export function getPitBoxRaceDistance(sim, stop, box) {
  const pitLane = sim.track.pitLane;
  const amount = pitLane?.mainLane?.length > 0 ? box.distanceAlongLane / pitLane.mainLane.length : 0;
  return stop.lapBase + pitLane.entry.distanceFromStart +
    (pitLane.exit.distanceFromStart - pitLane.entry.distanceFromStart) * amount;
}
