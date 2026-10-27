import { beginPitPenaltyService, completePitPenaltyService } from './pitPenaltyService.js';
import { beginTireService, completePitService } from './pitTireService.js';
import { getPitStopBox } from './pitOccupancy.js';
import { holdPitCarAtBox } from './pitCarPlacement.js';

export function beginPitService(sim, car, box) {
  const stop = car.pitStop;
  stop.status = 'servicing';
  stop.route = null;
  stop.routeProgress = 0;
  holdPitCarAtBox(sim, car, box);

  if (beginPitPenaltyService(sim, car)) return;
  beginTireService(sim, car);
}

export function advancePitService(sim, car, delta) {
  const stop = car.pitStop;
  const box = getPitStopBox(sim, stop);
  if (!box) return true;
  if (stop.phase === 'penalty') {
    stop.penaltyServiceRemaining = Math.max(0, (stop.penaltyServiceRemaining ?? 0) - delta);
    stop.serviceRemaining = stop.penaltyServiceRemaining;
  } else {
    stop.serviceRemaining = Math.max(0, (stop.serviceRemaining ?? 0) - delta);
  }
  holdPitCarAtBox(sim, car, box, { updatePreviousPose: true });
  if (stop.phase === 'penalty' && stop.penaltyServiceRemaining <= 0) {
    completePitPenaltyService(sim, car);
  } else if (stop.serviceRemaining <= 0) {
    completePitService(sim, car);
  }
  return true;
}
