import { nearestTrackState } from './trackModel.js';

export function pitOverrideAllowedForCar(car) {
  if (!car?.environmentControlled) return true;
  const status = car.pitStop?.status ?? null;
  const pitRouteActive = status != null && status !== 'pending' && status !== 'completed';
  const pitIntentCommitted = Number(car.pitStop?.intent ?? car.pitIntent ?? 0) >= 2;
  return pitRouteActive || pitIntentCommitted;
}

export function nearestTrackStateForCar(
  track,
  car,
  position = car,
  progressHint = car?.progress ?? null,
  options = {},
) {
  const resolvedAllowPitOverride = options.allowPitOverride ?? pitOverrideAllowedForCar(car);
  return nearestTrackState(track, position, progressHint, {
    indexMode: options.indexMode ?? 'legacy',
    ...options,
    allowPitOverride: resolvedAllowPitOverride,
  });
}
