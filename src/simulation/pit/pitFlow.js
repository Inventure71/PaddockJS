import { pitLaneStatusSnapshot } from './pitSnapshots.js';
import {
  firstDifferentCompound,
  normalizePitIntent,
  shouldStartPitStopForSimulation,
  updateAutomaticPitIntentForSimulation,
} from './pitIntent.js';
import {
  advancePitService,
  applyPitRoutePosition,
  beginPitQueue,
  beginPitService,
  finishPitExit,
  getPitBoxRaceDistance,
  getPitStopBox,
  isPitServiceBusy,
  isPitServiceQueueOccupied,
  releasePitQueue,
} from './pitService.js';
import {
  createPitApproachPoints,
  createRoute,
  pitDriveLaneOffset,
  pitMainLanePointAt,
  routePoint,
} from './pitRouting.js';
import { metersToSimUnits } from '../units.js';
import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';

const PIT_ENTRY_APPROACH_DISTANCE = metersToSimUnits(250);
const PIT_BOX_APPROACH_DISTANCE = metersToSimUnits(34);
const PIT_SERVICE_QUEUE_FALLBACK_GAP = metersToSimUnits(48);
const PIT_ENTRY_LATE_THRESHOLD_DISTANCE = metersToSimUnits(90);

export function isCarInActivePitStop(sim, car) {
  return Boolean(car?.pitStop && car.pitStop.status !== 'pending' && car.pitStop.status !== 'completed');
}

export function schedulePitStopAtNextEntry(sim, car, stop) {
  const pitLane = sim.track.pitLane;
  if (!stop || !pitLane?.entry || !Number.isFinite(sim.track.length) || sim.track.length <= 0) return false;
  const raceDistance = car.raceDistance ?? 0;
  const entryOffset = pitLane.entry.distanceFromStart ?? 0;
  let lapBase = Math.floor((raceDistance - entryOffset) / sim.track.length) * sim.track.length;
  let entryRaceDistance = lapBase + entryOffset;

  while (raceDistance > entryRaceDistance + PIT_ENTRY_LATE_THRESHOLD_DISTANCE) {
    lapBase += sim.track.length;
    entryRaceDistance = lapBase + entryOffset;
  }

  stop.lapBase = lapBase;
  stop.entryRaceDistance = entryRaceDistance;
  stop.plannedRaceDistance = entryRaceDistance - PIT_ENTRY_APPROACH_DISTANCE;
  return true;
}

export function rearmCompletedPitStop(sim, car, stop) {
  if (!stop || stop.status !== 'completed') return false;
  stop.status = 'pending';
  stop.phase = null;
  stop.route = null;
  stop.routeProgress = 0;
  stop.routeStartRaceDistance = null;
  stop.routeEndRaceDistance = null;
  stop.serviceRemaining = 0;
  stop.penaltyServiceRemaining = 0;
  stop.penaltyServiceTotal = 0;
  stop.servingPenaltyIds = [];
  stop.queueingForService = false;
  stop.serviceProfile = null;
  stop.targetTire = stop.targetTire ?? firstDifferentCompound(car.tire, sim.rules.modules?.tireStrategy?.compounds);
  return schedulePitStopAtNextEntry(sim, car, stop);
}

export function canStartPitStop(sim, car) {
  const stop = car.pitStop;
  const pitStops = sim.rules.modules?.pitStops;
  if (!stop || !pitStops?.enabled) return false;
  const active = sim.cars.filter((candidate) => candidate !== car && isCarInActivePitStop(sim, candidate));
  const maxConcurrentPitLaneCars = Math.max(1, Math.floor(pitStops.maxConcurrentPitLaneCars ?? 3));
  if (active.length >= maxConcurrentPitLaneCars) return false;

  if (!pitStops.doubleStacking && stop.teamId) {
    const box = getPitStopBox(sim, stop);
    if (isPitServiceQueueOccupied(sim, car, box)) return false;
  }

  const minimumGap = Math.max(0, pitStops.minimumPitLaneGap ?? 0);
  const candidateDistance = car.raceDistance ?? 0;
  return active.every((candidate) => {
    const gap = (candidate.raceDistance ?? 0) - candidateDistance;
    return gap < 0 || gap >= minimumGap;
  });
}

export function shouldStartPitStop(sim, car) {
  return shouldStartPitStopForSimulation(sim, car);
}

export function updateAutomaticPitIntent(sim, car) {
  updateAutomaticPitIntentForSimulation(sim, car);
}

export function isPitLaneOpenForStops(sim) {
  return pitLaneStatusSnapshot(sim.raceControl, sim.track.pitLane, sim.rules.modules?.pitStops).open;
}

export function pitEntryLateThresholdDistance() {
  return PIT_ENTRY_LATE_THRESHOLD_DISTANCE;
}

export function startPitStop(sim, car) {
  const stop = car.pitStop;
  const box = getPitStopBox(sim, stop);
  const pitLane = sim.track.pitLane;
  if (!stop || !box || !pitLane?.enabled) return false;

  car.gridLocked = false;
  car.drsActive = false;
  car.drsEligible = false;
  car.drsZoneId = null;
  car.drsZoneEnabled = false;
  car.canAttack = false;
  stop.targetTire = stop.targetTire ?? firstDifferentCompound(car.tire, sim.rules.modules?.tireStrategy?.compounds);

  const currentState = applyWheelSurfaceState(car, sim.track).representativeState;
  sim.events.unshift({
    type: 'pit-entry',
    at: sim.time,
    carId: car.id,
    boxId: box.id,
    teamId: box.teamId ?? null,
  });

  if (currentState.surface === 'pit-box' && currentState.pitBoxId === box.id) {
    beginPitService(sim, car, box);
    return true;
  }

  const hasServiceQueue = Boolean(box.queuePoint);
  const shouldStageForService = hasServiceQueue;
  const queueDistanceAlongLane = box.queueDistanceAlongLane ??
    Math.max(0, box.distanceAlongLane - PIT_SERVICE_QUEUE_FALLBACK_GAP);
  const stopDistanceAlongLane = shouldStageForService
    ? queueDistanceAlongLane
    : box.distanceAlongLane;
  const serviceTarget = shouldStageForService ? box.queuePoint : box.center;
  const driveLaneOffset = pitDriveLaneOffset(pitLane);
  const boxApproachDistance = Math.max(
    0,
    (hasServiceQueue ? queueDistanceAlongLane : stopDistanceAlongLane) - PIT_BOX_APPROACH_DISTANCE,
  );
  const route = createRoute([
    ...createPitApproachPoints(sim.track, car, pitLane, stop.entryRaceDistance),
    ...(pitLane.entry.roadCenterline ?? []).map((point) => routePoint(point)),
    routePoint(pitMainLanePointAt(pitLane, 0, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
    routePoint(pitMainLanePointAt(pitLane, boxApproachDistance, driveLaneOffset), pitLane.mainLane.heading, { limiterActive: true }),
    routePoint(serviceTarget, pitLane.mainLane.heading, { limiterActive: true }),
  ]);
  stop.status = 'entering';
  stop.phase = 'entry';
  stop.queueingForService = shouldStageForService;
  stop.route = route;
  stop.routeProgress = 0;
  stop.routeStartRaceDistance = car.raceDistance ?? stop.plannedRaceDistance;
  stop.routeEndRaceDistance = getPitBoxRaceDistance(sim, stop, {
    ...box,
    distanceAlongLane: stopDistanceAlongLane,
  });
  return true;
}

export function advancePitStopCar(sim, car, delta) {
  const pitStops = sim.rules.modules?.pitStops;
  const stop = car.pitStop;
  if (!pitStops?.enabled || !stop) return false;
  if (stop.status === 'pending' || stop.status === 'completed') updateAutomaticPitIntent(sim, car);
  if (stop.status === 'completed') return false;
  if (stop.status === 'pending' && !shouldStartPitStop(sim, car)) return false;
  if (stop.status === 'pending') startPitStop(sim, car);

  if (stop.status === 'entering') {
    const finishedRoute = applyPitRoutePosition(sim, car, delta);
    const box = getPitStopBox(sim, stop);
    if (finishedRoute && box) {
      if (stop.queueingForService) {
        if (!isPitServiceBusy(sim, car, box) && !isPitServiceQueueOccupied(sim, car, box)) {
          releasePitQueue(sim, car, box, { fromCurrent: true });
        } else {
          beginPitQueue(sim, car, box);
        }
      }
      else beginPitService(sim, car, box);
    }
    car.contactCooldown = Math.max(0, car.contactCooldown - delta);
    return true;
  }

  if (stop.status === 'queued') {
    const box = getPitStopBox(sim, stop);
    if (!box) return true;
    car.previousX = car.x;
    car.previousY = car.y;
    car.previousHeading = car.heading;
    car.x = box.queuePoint.x;
    car.y = box.queuePoint.y;
    car.heading = sim.track.pitLane.mainLane.heading;
    car.speed = 0;
    car.throttle = 0;
    car.brake = 1;
    applyWheelSurfaceState(car, sim.track);
    car.progress = car.trackState.distance;
    car.raceDistance = getPitBoxRaceDistance(sim, stop, {
      ...box,
      distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
    });
    if (!isPitServiceBusy(sim, car, box)) releasePitQueue(sim, car, box);
    return true;
  }

  if (stop.status === 'servicing') {
    return advancePitService(sim, car, delta);
  }

  if (stop.status === 'exiting') {
    const finishedRoute = applyPitRoutePosition(sim, car, delta);
    if (finishedRoute) finishPitExit(sim, car);
    car.contactCooldown = Math.max(0, car.contactCooldown - delta);
    return true;
  }

  return false;
}
