const DEFAULT_PROGRESS_REWARD_WEIGHTS = Object.freeze({
  progress: 1,
  speed: 0.01,
  offTrack: -2,
  collision: -10,
  steering: -0.03,
  brake: -0.02,
});

export function createProgressReward(options = {}) {
  const weights = {
    ...DEFAULT_PROGRESS_REWARD_WEIGHTS,
    ...(options.weights ?? {}),
  };

  return function progressReward(context = {}) {
    const driverId = context.driverId;
    const previousCar = findSnapshotCar(context.previous, driverId);
    const currentCar = findSnapshotCar(context.state?.snapshot, driverId);
    const progressMeters = getProgressMeters(previousCar, currentCar);
    const self = context.current?.object?.self ?? {};
    const speedKph = Number(self.speedKph ?? 0);
    const isOnTrack = self.onTrack !== false;
    const collisionCount = countDriverCollisions(context.events, driverId);
    const steering = Math.abs(Number(context.action?.steering ?? 0));
    const brake = Math.abs(Number(context.action?.brake ?? 0));

    return (
      progressMeters * weights.progress +
      (isOnTrack ? speedKph * weights.speed : 0) +
      (isOnTrack ? 0 : weights.offTrack) +
      collisionCount * weights.collision +
      steering * weights.steering +
      brake * weights.brake
    );
  };
}

function findSnapshotCar(snapshot, driverId) {
  if (!snapshot || !driverId || !Array.isArray(snapshot.cars)) return null;
  return snapshot.cars.find((car) => car?.id === driverId) ?? null;
}

function getProgressMeters(previousCar, currentCar) {
  if (!previousCar || !currentCar) return 0;
  const previous = Number(previousCar.distanceMeters ?? previousCar.raceDistanceMeters ?? 0);
  const current = Number(currentCar.distanceMeters ?? currentCar.raceDistanceMeters ?? 0);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return 0;
  return current - previous;
}

function countDriverCollisions(events = [], driverId) {
  if (!driverId || !Array.isArray(events)) return 0;
  return events.filter((event) => isCollisionEvent(event) && eventIncludesDriver(event, driverId)).length;
}

function isCollisionEvent(event) {
  return event?.type === 'collision' || event?.type === 'contact';
}

function eventIncludesDriver(event, driverId) {
  if (event.driverId === driverId ||
      event.carId === driverId ||
      event.primaryDriverId === driverId ||
      event.otherDriverId === driverId) {
    return true;
  }
  return Array.isArray(event.driverIds) && event.driverIds.includes(driverId);
}
