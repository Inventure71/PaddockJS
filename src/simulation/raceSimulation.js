import {
  buildTrackModel,
  createProceduralTrack,
  nearestTrackState,
  offsetTrackPoint,
  pointAt,
  TRACK,
  WORLD,
} from './trackModel.js';
import { decideDriverControls } from './driverController.js';
import { buildCollisionCandidatePairs, detectVehicleCollision } from './collisionGeometry.js';
import { calculateCollisionPenalties } from './rules/collisionSteward.js';
import {
  applyUnservedServicePenalty,
  cancelPenaltyRecord,
  createPenaltyEvent,
  createPenaltyRecord,
  isPenaltyActive,
  serializePenalty,
  servePenaltyRecord,
} from './rules/penaltyLedger.js';
import { calculateTireRequirementPenalty } from './rules/tireRequirementSteward.js';
import { calculateTrackLimitReview } from './rules/trackLimitsSteward.js';
import { calculatePitLaneSpeedingReview } from './rules/pitLaneSpeedingSteward.js';
import { DEFAULT_RULES, getPenaltyRule, normalizeRaceRules } from './rulesConfig.js';
import { clamp, createMulberry32, normalizeAngle, wrapDistance } from './simMath.js';
import { metersToSimUnits, simSpeedToKph, simUnitsToMeters } from './units.js';
import { integrateVehiclePhysics, VEHICLE_LIMITS } from './vehiclePhysics.js';
import { applyWheelSurfaceState } from './wheelSurface.js';
import { applyExternalCarState, createCar, getStartGridSlot } from './vehicle/vehicleState.js';
import {
  serializeCar as serializeVehicleCar,
  serializeObservationCar as serializeVehicleObservationCar,
  serializeRenderCar as serializeVehicleRenderCar,
} from './vehicle/vehicleSnapshots.js';
import {
  createLapTelemetry,
  createTimingLines,
  estimateGapAheadSeconds,
  recordTimingLineCrossings,
  recordTimingSample,
  resetLapTelemetry,
  resetTimingHistory,
  resetTimingLineCrossings,
  serializeLapTelemetry,
  updateLapTelemetry,
  updateSectorPerformance,
  wholeLapGap,
} from './timing/raceTiming.js';
import { updateDrsLatch as updateDrsLatchState } from './timing/drsTiming.js';
import {
  firstDifferentCompound,
  normalizePitCompound,
  normalizePitIntent,
  setPitIntentForSimulation,
  shouldStartPitStopForSimulation,
  updateAutomaticPitIntentForSimulation,
} from './pit/pitIntent.js';
import { assignPitLaneTeams as assignPitLaneTeamsState, initializePitStops as initializePitStopsState } from './pit/pitState.js';
import {
  advancePitService as advancePitServiceForSimulation,
  applyPitRoutePosition as applyPitRoutePositionForSimulation,
  beginPitPenaltyService as beginPitPenaltyServiceForSimulation,
  beginPitQueue as beginPitQueueForSimulation,
  beginPitService as beginPitServiceForSimulation,
  beginTireService as beginTireServiceForSimulation,
  calculatePitServiceProfile as calculatePitServiceProfileForSimulation,
  completePitPenaltyService as completePitPenaltyServiceForSimulation,
  completePitService as completePitServiceForSimulation,
  finishPitExit as finishPitExitForSimulation,
  getPitBoxRaceDistance as getPitBoxRaceDistanceForSimulation,
  getPitServicePenalties as getPitServicePenaltiesForSimulation,
  getPitStopBox as getPitStopBoxForSimulation,
  isPitServiceAreaOccupied as isPitServiceAreaOccupiedForSimulation,
  isPitServiceBusy as isPitServiceBusyForSimulation,
  isPitServiceQueueOccupied as isPitServiceQueueOccupiedForSimulation,
  releasePitQueue as releasePitQueueForSimulation,
} from './pit/pitService.js';
import {
  pitLaneStatusSnapshot,
  serializeObservationPitStop as serializePitObservationSnapshot,
  serializePitStop,
  serializeRenderPitStop,
} from './pit/pitSnapshots.js';
import {
  clonePitLaneModel,
  createPitApproachPoints,
  createRoute,
  nearestDistanceOnRoute,
  offsetPitLanePoint,
  pitDriveLaneOffset,
  pitMainLanePointAt,
  routePoint,
  shiftPreviousRenderPose,
} from './pit/pitRouting.js';
import {
  moveSafetyCarTo as moveSafetyCarToState,
  setRedFlagState,
  setSafetyCarState,
  updateSafetyCarState,
} from './race/safetyCar.js';
import {
  holdGridCars as holdGridCarsForSimulation,
  releaseRaceStart as releaseRaceStartForSimulation,
  setPitLaneOpenState,
  updateStartSequence as updateStartSequenceForSimulation,
} from './race/raceLifecycle.js';
import {
  applyClassificationConsequences as applyClassificationConsequencesState,
  applyOutstandingServicePenalties as applyOutstandingServicePenaltiesState,
  buildClassification as buildClassificationState,
  buildClassificationFromFinishOrder as buildClassificationFromFinishOrderState,
} from './race/classification.js';

const DEFAULT_TOTAL_LAPS = 10;
export const FIXED_STEP = 1 / 60;
const MIN_TOTAL_LAPS = 1;
const MAX_COLLISION_CORRECTION = 4.5;
const PIT_ENTRY_APPROACH_DISTANCE = metersToSimUnits(250);
const PIT_ROUTE_LOOKAHEAD_MIN = metersToSimUnits(35);
const PIT_ROUTE_LOOKAHEAD_MAX = metersToSimUnits(88);
const PIT_SERVICE_CLEAR_DISTANCE = VEHICLE_LIMITS.carLength * 0.9;
const PIT_DRIVE_LANE_OFFSET_RATIO = 0.28;
const PIT_BOX_APPROACH_DISTANCE = metersToSimUnits(34);
const PIT_SERVICE_QUEUE_FALLBACK_GAP = metersToSimUnits(48);
const PIT_INTENT_NONE = 0;
const PIT_INTENT_IF_FREE = 1;
const PIT_INTENT_COMMITTED = 2;

export { DEFAULT_RULES };

function isPitPositionControlledCar(car) {
  const status = car?.pitStop?.status;
  return status === 'entering' || status === 'queued' || status === 'servicing' || status === 'exiting';
}

function wrapProgress(value, length) {
  return wrapDistance(value, length);
}

function distanceForward(from, to, length) {
  return wrapProgress(to - from, length);
}

function normalizeTotalLaps(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MIN_TOTAL_LAPS;
  return Math.max(MIN_TOTAL_LAPS, Math.floor(numeric));
}

function forwardVector(car) {
  return { x: Math.cos(car.heading), y: Math.sin(car.heading) };
}

function velocityVector(car) {
  const forward = forwardVector(car);
  return { x: forward.x * car.speed, y: forward.y * car.speed };
}

function createCollisionStewardContext(first, second, collision) {
  const distanceDelta = collision.trackLength
    ? progressDelta(second.progress ?? second.raceDistance ?? 0, first.progress ?? first.raceDistance ?? 0, collision.trackLength)
    : (second.raceDistance ?? 0) - (first.raceDistance ?? 0);
  const sideBySideTolerance = VEHICLE_LIMITS.carLength * 0.18;
  if (Math.abs(distanceDelta) <= sideBySideTolerance) {
    const firstVelocity = velocityVector(first);
    const secondVelocity = velocityVector(second);
    const relativeVelocity = {
      x: firstVelocity.x - secondVelocity.x,
      y: firstVelocity.y - secondVelocity.y,
    };
    return {
      ...collision,
      impactSpeed: Math.hypot(relativeVelocity.x, relativeVelocity.y),
      aheadDriverId: null,
      atFaultDriverId: null,
      sharedFault: true,
      sharedFaultDriverIds: [first.id, second.id],
    };
  }

  const firstBehind = distanceDelta > 0;
  const behind = firstBehind ? first : second;
  const ahead = firstBehind ? second : first;
  const directionBehindToAhead = normalizeVector({
    x: ahead.x - behind.x,
    y: ahead.y - behind.y,
  });
  const behindVelocity = velocityVector(behind);
  const aheadVelocity = velocityVector(ahead);
  const relativeVelocity = {
    x: behindVelocity.x - aheadVelocity.x,
    y: behindVelocity.y - aheadVelocity.y,
  };

  return {
    ...collision,
    impactSpeed: Math.max(0, dot(relativeVelocity, directionBehindToAhead)),
    aheadDriverId: ahead.id,
    atFaultDriverId: behind.id,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function progressDelta(a, b, trackLength) {
  let delta = a - b;
  if (delta < -trackLength / 2) delta += trackLength;
  if (delta > trackLength / 2) delta -= trackLength;
  return delta;
}

function createEmptyPenaltyStats() {
  return {
    seconds: 0,
    positionDrop: 0,
    disqualified: false,
  };
}

function getPenaltyStats(statsByDriver, driverId) {
  return statsByDriver.get(driverId) ?? createEmptyPenaltyStats();
}

function buildPenaltyStatsByDriver(penalties = []) {
  const byDriver = new Map();
  penalties.forEach((penalty) => {
    if (!penalty?.driverId || !isPenaltyActive(penalty)) return;
    const stats = byDriver.get(penalty.driverId) ?? createEmptyPenaltyStats();
    stats.seconds += Number(penalty.penaltySeconds) || 0;
    stats.positionDrop += Number(penalty.positionDrop) || 0;
    stats.disqualified = stats.disqualified || Boolean(penalty.disqualified);
    byDriver.set(penalty.driverId, stats);
  });
  return byDriver;
}

function isLegallyInsidePitLaneForTrackLimits(car) {
  if (!car.trackState?.inPitLane) return false;
  const wheels = car.wheelStates ?? [];
  return wheels.length > 0 && wheels.some((wheel) => wheel.inPitLane);
}

export class F1RaceSimulation {
  constructor({ seed = 1, drivers = [], totalLaps = DEFAULT_TOTAL_LAPS, rules = {}, track = null, trackSeed = null } = {}) {
    this.seed = seed;
    this.random = createMulberry32(seed);
    const trackDefinition = track ?? (trackSeed == null ? TRACK : createProceduralTrack(trackSeed));
    const builtTrack = buildTrackModel(trackDefinition);
    this.track = {
      ...builtTrack,
      pitLane: clonePitLaneModel(builtTrack.pitLane),
    };
    this.track.timingLines = createTimingLines(this.track);
    this.trackSeed = this.track.seed ?? trackSeed;
    this.rules = normalizeRaceRules(rules);
    this.startLightsOutAt = this.rules.startLightCount * this.rules.startLightInterval + this.rules.startLightsOutHold;
    this.totalLaps = normalizeTotalLaps(totalLaps);
    this.time = 0;
    this.events = [];
    this.penalties = [];
    this.nextPenaltyId = 1;
    this.stewardState = {
      trackLimits: Object.create(null),
      pitLaneSpeeding: Object.create(null),
      tireRequirement: Object.create(null),
    };
    this.raceControl = {
      mode: this.rules.standingStart === false ? 'green' : 'pre-start',
      frozenOrder: null,
      redFlag: false,
      pitLaneOpen: true,
      finished: false,
      finishedAt: null,
      winnerId: null,
      classification: [],
      finishOrder: [],
      start: {
        lightCount: this.rules.startLightCount,
        lightsLit: 0,
        lightsOutAt: this.startLightsOutAt,
        released: this.rules.standingStart === false,
        releasedAt: this.rules.standingStart === false ? 0 : null,
      },
    };
    const safetyCarStart = pointAt(this.track, this.rules.safetyCarLeadDistance);
    this.safetyCar = {
      deployed: false,
      progress: this.rules.safetyCarLeadDistance,
      speed: this.rules.safetyCarSpeed,
      previousX: safetyCarStart.x,
      previousY: safetyCarStart.y,
      previousHeading: safetyCarStart.heading,
      x: safetyCarStart.x,
      y: safetyCarStart.y,
      heading: safetyCarStart.heading,
    };
    this.cars = drivers.map((driver, index) => createCar(driver, index, this.random, this.track, {
      standingStart: this.raceControl.mode === 'pre-start',
      createLapTelemetry,
    }));
    this.assignPitLaneTeams();
    this.initializePitStops();
    this.recalculateRaceState({ updateDrs: false });
    this.cars.forEach((car) => resetTimingHistory(car, this.time));
    this.cars.forEach((car) => resetTimingLineCrossings(car, this.time));
    this.cars.forEach((car) => resetLapTelemetry(car, this.time, this.track, this.totalLaps));
  }

  assignPitLaneTeams() {
    assignPitLaneTeamsState({ cars: this.cars, pitLane: this.track.pitLane });
  }

  initializePitStops() {
    initializePitStopsState({
      cars: this.cars,
      pitLane: this.track.pitLane,
      pitStops: this.rules.modules?.pitStops,
      totalLaps: this.totalLaps,
      trackLength: this.track.length,
      tireCompounds: this.rules.modules?.tireStrategy?.compounds,
      PIT_INTENT_NONE,
    });
  }

  setSafetyCar(deployed) {
    setSafetyCarState(this, deployed);
  }

  setRedFlag(deployed) {
    setRedFlagState(this, deployed);
  }

  setPitLaneOpen(open) {
    setPitLaneOpenState(this, open);
  }

  setCarState(id, partial) {
    const car = this.cars.find((item) => item.id === id);
    if (!car) return;
    applyExternalCarState(car, partial, {
      cars: this.cars,
      computeLap: (raceDistance) => this.computeLap(raceDistance),
      nearestDistanceOnRoute,
      progressDelta,
      raceControl: this.raceControl,
      releaseRaceStart: () => this.releaseRaceStart(),
      resetLapTelemetry,
      resetTimingHistory,
      resetTimingLineCrossings,
      time: this.time,
      totalLaps: this.totalLaps,
      track: this.track,
    });
    this.recalculateRaceState({ updateDrs: false });
    this.evaluateRaceFinish();
  }

  setCarControls(id, controls) {
    const car = this.cars.find((item) => item.id === id);
    if (!car) return;
    car.manualControls = controls;
  }

  clearCarControls(id) {
    const car = this.cars.find((item) => item.id === id);
    if (car) car.manualControls = null;
  }

  setAutomaticPitIntentEnabled(id, enabled) {
    const car = this.cars.find((item) => item.id === id);
    if (!car) return false;
    car.automaticPitIntentEnabled = Boolean(enabled);
    return true;
  }

  getPitIntent(id) {
    const car = this.cars.find((item) => item.id === id);
    return normalizePitIntent(car?.pitStop?.intent) ?? PIT_INTENT_NONE;
  }

  getPitTargetCompound(id) {
    const car = this.cars.find((item) => item.id === id);
    return car?.pitStop?.targetTire ?? null;
  }

  setPitIntent(id, intent, targetCompound = undefined) {
    return setPitIntentForSimulation(this, id, intent, targetCompound);
  }

  isCarInActivePitStop(car) {
    return Boolean(car.pitStop && car.pitStop.status !== 'pending' && car.pitStop.status !== 'completed');
  }

  schedulePitStopAtNextEntry(car, stop) {
    const pitLane = this.track.pitLane;
    if (!stop || !pitLane?.entry || !Number.isFinite(this.track.length) || this.track.length <= 0) return false;
    const raceDistance = car.raceDistance ?? 0;
    const entryOffset = pitLane.entry.distanceFromStart ?? 0;
    let lapBase = Math.floor((raceDistance - entryOffset) / this.track.length) * this.track.length;
    let entryRaceDistance = lapBase + entryOffset;

    while (raceDistance > entryRaceDistance + metersToSimUnits(90)) {
      lapBase += this.track.length;
      entryRaceDistance = lapBase + entryOffset;
    }

    stop.lapBase = lapBase;
    stop.entryRaceDistance = entryRaceDistance;
    stop.plannedRaceDistance = entryRaceDistance - PIT_ENTRY_APPROACH_DISTANCE;
    return true;
  }

  rearmCompletedPitStop(car, stop) {
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
    stop.targetTire = stop.targetTire ?? firstDifferentCompound(car.tire, this.rules.modules?.tireStrategy?.compounds);
    return this.schedulePitStopAtNextEntry(car, stop);
  }

  canStartPitStop(car) {
    const stop = car.pitStop;
    const pitStops = this.rules.modules?.pitStops;
    if (!stop || !pitStops?.enabled) return false;
    const active = this.cars.filter((candidate) => candidate !== car && this.isCarInActivePitStop(candidate));
    const maxConcurrentPitLaneCars = Math.max(1, Math.floor(pitStops.maxConcurrentPitLaneCars ?? 3));
    if (active.length >= maxConcurrentPitLaneCars) return false;

    if (!pitStops.doubleStacking && stop.teamId) {
      const box = this.getPitStopBox(stop);
      if (this.isPitServiceQueueOccupied(car, box)) return false;
    }

    const minimumGap = Math.max(0, pitStops.minimumPitLaneGap ?? 0);
    const candidateDistance = car.raceDistance ?? 0;
    return active.every((candidate) => {
      const gap = (candidate.raceDistance ?? 0) - candidateDistance;
      return gap < 0 || gap >= minimumGap;
    });
  }

  shouldStartPitStop(car) {
    return shouldStartPitStopForSimulation(this, car);
  }

  updateAutomaticPitIntent(car) {
    updateAutomaticPitIntentForSimulation(this, car);
  }

  isPitLaneOpenForStops() {
    return pitLaneStatusSnapshot(this.raceControl, this.track.pitLane, this.rules.modules?.pitStops).open;
  }

  pitEntryLateThresholdDistance() {
    return metersToSimUnits(90);
  }

  getPitStopBox(stop) {
    return getPitStopBoxForSimulation(this, stop);
  }

  isPitServiceBusy(car, box) {
    return isPitServiceBusyForSimulation(this, car, box, PIT_SERVICE_CLEAR_DISTANCE);
  }

  isPitServiceAreaOccupied(candidate, box) {
    return isPitServiceAreaOccupiedForSimulation(this, candidate, box, PIT_SERVICE_CLEAR_DISTANCE);
  }

  isPitServiceQueueOccupied(car, box) {
    return isPitServiceQueueOccupiedForSimulation(this, car, box);
  }

  getPitBoxRaceDistance(stop, box) {
    return getPitBoxRaceDistanceForSimulation(this, stop, box);
  }

  startPitStop(car) {
    const stop = car.pitStop;
    const box = this.getPitStopBox(stop);
    const pitLane = this.track.pitLane;
    if (!stop || !box || !pitLane?.enabled) return false;

    car.gridLocked = false;
    car.drsActive = false;
    car.drsEligible = false;
    car.drsZoneId = null;
    car.drsZoneEnabled = false;
    car.canAttack = false;
    stop.targetTire = stop.targetTire ?? firstDifferentCompound(car.tire, this.rules.modules?.tireStrategy?.compounds);

    const currentState = applyWheelSurfaceState(car, this.track).representativeState;
    this.events.unshift({
      type: 'pit-entry',
      at: this.time,
      carId: car.id,
      boxId: box.id,
      teamId: box.teamId ?? null,
    });

    if (currentState.surface === 'pit-box' && currentState.pitBoxId === box.id) {
      this.beginPitService(car, box);
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
      ...createPitApproachPoints(this.track, car, pitLane, stop.entryRaceDistance),
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
    stop.routeEndRaceDistance = this.getPitBoxRaceDistance(stop, {
      ...box,
      distanceAlongLane: stopDistanceAlongLane,
    });
    return true;
  }

  beginPitQueue(car, box) {
    return beginPitQueueForSimulation(this, car, box);
  }

  releasePitQueue(car, box, { fromCurrent = false } = {}) {
    return releasePitQueueForSimulation(this, car, box, { fromCurrent });
  }

  beginPitService(car, box) {
    return beginPitServiceForSimulation(this, car, box);
  }

  beginPitPenaltyService(car) {
    return beginPitPenaltyServiceForSimulation(this, car);
  }

  calculatePitServiceProfile(car) {
    return calculatePitServiceProfileForSimulation(this, car);
  }

  beginTireService(car) {
    return beginTireServiceForSimulation(this, car);
  }

  completePitPenaltyService(car) {
    return completePitPenaltyServiceForSimulation(this, car);
  }

  getPitServicePenalties(driverId) {
    return getPitServicePenaltiesForSimulation(this, driverId);
  }

  completePitService(car) {
    return completePitServiceForSimulation(this, car);
  }

  finishPitExit(car) {
    return finishPitExitForSimulation(this, car);
  }

  applyPitRoutePosition(car, delta) {
    return applyPitRoutePositionForSimulation(this, car, delta);
  }

  advancePitStopCar(car, delta) {
    const pitStops = this.rules.modules?.pitStops;
    const stop = car.pitStop;
    if (!pitStops?.enabled || !stop) return false;
    if (stop.status === 'pending' || stop.status === 'completed') this.updateAutomaticPitIntent(car);
    if (stop.status === 'completed') return false;
    if (stop.status === 'pending' && !this.shouldStartPitStop(car)) return false;
    if (stop.status === 'pending') this.startPitStop(car);

    if (stop.status === 'entering') {
      const finishedRoute = this.applyPitRoutePosition(car, delta);
      const box = this.getPitStopBox(stop);
      if (finishedRoute && box) {
        if (stop.queueingForService) {
          if (!this.isPitServiceBusy(car, box) && !this.isPitServiceQueueOccupied(car, box)) {
            this.releasePitQueue(car, box, { fromCurrent: true });
          } else {
            this.beginPitQueue(car, box);
          }
        }
        else this.beginPitService(car, box);
      }
      car.contactCooldown = Math.max(0, car.contactCooldown - delta);
      return true;
    }

    if (stop.status === 'queued') {
      const box = this.getPitStopBox(stop);
      if (!box) return true;
      car.previousX = car.x;
      car.previousY = car.y;
      car.previousHeading = car.heading;
      car.x = box.queuePoint.x;
      car.y = box.queuePoint.y;
      car.heading = this.track.pitLane.mainLane.heading;
      car.speed = 0;
      car.throttle = 0;
      car.brake = 1;
      applyWheelSurfaceState(car, this.track);
      car.progress = car.trackState.distance;
      car.raceDistance = this.getPitBoxRaceDistance(stop, {
        ...box,
        distanceAlongLane: box.queueDistanceAlongLane ?? box.distanceAlongLane,
      });
      if (!this.isPitServiceBusy(car, box)) this.releasePitQueue(car, box);
      return true;
    }

    if (stop.status === 'servicing') {
      return advancePitServiceForSimulation(this, car, delta);
    }

    if (stop.status === 'exiting') {
      const finishedRoute = this.applyPitRoutePosition(car, delta);
      if (finishedRoute) this.finishPitExit(car);
      car.contactCooldown = Math.max(0, car.contactCooldown - delta);
      return true;
    }

    return false;
  }

  step(dt) {
    const delta = clamp(dt, 0, 1 / 20);
    if (!Number.isFinite(delta) || delta <= 0) return;

    this.time += delta;
    this.events = [];
    this.updateStartSequence();
    this.recalculateRaceState({ updateDrs: false });

    if (this.raceControl.mode === 'pre-start' && this.cars.every((car) => car.gridLocked)) {
      this.holdGridCars();
      this.recalculateRaceState({ updateDrs: false });
      return;
    }

    if (this.raceControl.redFlag) {
      this.cars.forEach((car) => {
        car.previousX = car.x;
        car.previousY = car.y;
        car.previousHeading = car.heading;
        car.speed = 0;
        car.throttle = 0;
        car.brake = 1;
        car.drsActive = false;
        car.drsEligible = false;
        car.drsZoneId = null;
        car.drsZoneEnabled = false;
        car.canAttack = false;
      });
      this.recalculateRaceState({ updateDrs: false });
      return;
    }

    this.updateSafetyCar(delta);

    const orderedCars = this.orderedCars();
    const raceContext = this.driverRaceContext(orderedCars);
    orderedCars.forEach((car, index) => {
      car.previousX = car.x;
      car.previousY = car.y;
      car.previousHeading = car.heading;
      car.previousProgress = car.progress;
      if (this.advancePitStopCar(car, delta)) return;
      const controls = decideDriverControls({
        car,
        orderIndex: index,
        race: raceContext,
      });
      integrateVehiclePhysics(car, controls, delta);
      this.applyRunoffResponse(car);
      car.contactCooldown = Math.max(0, car.contactCooldown - delta);
    });

    this.resolveCollisions();
    this.recalculateRaceState();
    this.reviewTrackLimits();
    this.reviewPitLaneSpeeding();
  }

  recordPenalty(penalty) {
    const car = this.cars.find((item) => item.id === penalty.driverId);
    const entry = createPenaltyRecord({
      sequence: this.nextPenaltyId,
      time: this.time,
      lap: this.computeLap(car?.raceDistance ?? 0),
      penalty,
    });
    this.nextPenaltyId += 1;
    this.penalties.push(entry);
    if (entry.gridDrop > 0 && this.raceControl.mode === 'pre-start') {
      this.applyGridDrop(entry.driverId, entry.gridDrop);
    }
    this.events.unshift(createPenaltyEvent(entry));
    return entry;
  }

  servePenalty(penaltyId) {
    const penalty = this.penalties.find((entry) => entry.id === penaltyId);
    const result = servePenaltyRecord(penalty, this.time);
    if (result) {
      this.events.unshift({
        type: 'penalty-served',
        at: this.time,
        penaltyId: result.id,
        driverId: result.driverId,
        serviceType: result.serviceType,
      });
    }
    return result;
  }

  cancelPenalty(penaltyId) {
    const penalty = this.penalties.find((entry) => entry.id === penaltyId);
    const result = cancelPenaltyRecord(penalty, this.time);
    if (result) {
      this.events.unshift({
        type: 'penalty-cancelled',
        at: this.time,
        penaltyId: result.id,
        driverId: result.driverId,
      });
    }
    return result;
  }

  getDriverPenaltySeconds(driverId) {
    return getPenaltyStats(this.getPenaltyStatsByDriver(), driverId).seconds;
  }

  getDriverPositionDrop(driverId) {
    return getPenaltyStats(this.getPenaltyStatsByDriver(), driverId).positionDrop;
  }

  isDriverDisqualified(driverId) {
    return getPenaltyStats(this.getPenaltyStatsByDriver(), driverId).disqualified;
  }

  getPenaltyStatsByDriver() {
    return buildPenaltyStatsByDriver(this.penalties);
  }

  applyGridDrop(driverId, positions) {
    const drop = Math.max(0, Math.floor(Number(positions) || 0));
    if (drop <= 0) return;

    const ordered = [...this.cars].sort((left, right) => {
      const delta = right.gridDistance - left.gridDistance;
      return delta === 0 ? left.index - right.index : delta;
    });
    const currentIndex = ordered.findIndex((car) => car.id === driverId);
    if (currentIndex < 0) return;
    const [car] = ordered.splice(currentIndex, 1);
    ordered.splice(Math.min(ordered.length, currentIndex + drop), 0, car);

    ordered.forEach((entry, index) => {
      const { gridDistance, gridOffset } = getStartGridSlot(index, { standingStart: true });
      const gridPoint = pointAt(this.track, gridDistance);
      const position = offsetTrackPoint(gridPoint, gridOffset);
      entry.gridDistance = gridDistance;
      entry.gridOffset = gridOffset;
      entry.rank = index + 1;
      if (entry.gridLocked) {
        entry.x = position.x;
        entry.y = position.y;
        entry.previousX = position.x;
        entry.previousY = position.y;
        entry.heading = gridPoint.heading;
        entry.previousHeading = gridPoint.heading;
        entry.progress = gridPoint.distance;
        entry.raceDistance = gridDistance;
        applyWheelSurfaceState(entry, this.track);
      }
    });
  }

  reviewCollision(first, second, collision) {
    const rule = getPenaltyRule(this.rules, 'collision');
    calculateCollisionPenalties({ first, second, collision, rule })
      .forEach((penalty) => this.recordPenalty(penalty));
  }

  reviewTireRequirement(car) {
    if (this.stewardState.tireRequirement[car.id]) return;
    const rule = getPenaltyRule(this.rules, 'tireRequirement');
    const penalty = calculateTireRequirementPenalty({
      car,
      tireStrategy: this.rules.modules?.tireStrategy,
      rule,
    });
    this.stewardState.tireRequirement[car.id] = true;
    if (penalty) this.recordPenalty(penalty);
  }

  reviewTrackLimits() {
    const rule = getPenaltyRule(this.rules, 'trackLimits');
    if (!rule) return;

    this.cars.forEach((car) => {
      const currentState = this.stewardState.trackLimits[car.id];
      if (isLegallyInsidePitLaneForTrackLimits(car) && !currentState?.active) {
        return;
      }
      const review = calculateTrackLimitReview({
        car,
        rule,
        track: this.track,
        stewardState: currentState,
      });
      this.stewardState.trackLimits[car.id] = review.nextState;
      if (review.event) this.events.unshift({ ...review.event, at: this.time });
      if (review.penalty) this.recordPenalty(review.penalty);
    });
  }

  reviewPitLaneSpeeding() {
    const rule = getPenaltyRule(this.rules, 'pitLaneSpeeding');
    if (!rule) return;

    this.cars.forEach((car) => {
      const currentState = this.stewardState.pitLaneSpeeding[car.id];
      const review = calculatePitLaneSpeedingReview({
        car: {
          ...car,
          speedKph: simSpeedToKph(car.speed),
        },
        rule,
        stewardState: currentState,
      });
      this.stewardState.pitLaneSpeeding[car.id] = review.nextState;
      if (review.event) this.events.unshift({ ...review.event, at: this.time });
      if (review.penalty) this.recordPenalty(review.penalty);
    });
  }

  vehicleSnapshotDependencies() {
    return {
      createLapTelemetry,
      normalizePitIntent,
      PIT_INTENT_NONE,
      serializeLapTelemetry,
      serializeObservationPitStop: (pitStop) => serializePitObservationSnapshot(
        pitStop,
        normalizePitIntent,
        PIT_INTENT_NONE,
      ),
      serializePitStop: (pitStop) => serializePitStop(pitStop, normalizePitIntent, PIT_INTENT_NONE),
      serializeRenderPitStop,
      simSpeedToKph,
      simUnitsToMeters,
      VEHICLE_LIMITS,
    };
  }

  snapshot() {
    const ordered = this.orderedCars();
    const pitLaneStatus = pitLaneStatusSnapshot(this.raceControl, this.track.pitLane, this.rules.modules?.pitStops);
    const penaltyStats = this.getPenaltyStatsByDriver();
    const vehicleSnapshotDependencies = this.vehicleSnapshotDependencies();
    return {
      time: this.time,
      world: WORLD,
      track: this.track,
      totalLaps: this.totalLaps,
      raceControl: {
        mode: this.raceControl.mode,
        redFlag: Boolean(this.raceControl.redFlag),
        pitLaneOpen: pitLaneStatus.open,
        pitLaneStatus,
        finished: this.raceControl.finished,
        finishedAt: this.raceControl.finishedAt,
        winner: this.getRaceWinnerSnapshot(),
        classification: this.raceControl.classification.map((entry) => ({ ...entry })),
        start: {
          ...this.raceControl.start,
          visible: this.raceControl.mode === 'pre-start' ||
            (this.raceControl.start.releasedAt != null && this.time - this.raceControl.start.releasedAt < 1.45),
        },
      },
      pitLaneStatus,
      safetyCar: { ...this.safetyCar },
      rules: this.rules,
      events: [...this.events],
      penalties: this.penalties.map(serializePenalty),
      cars: ordered.map((car, index) => serializeVehicleCar(
        car,
        index + 1,
        getPenaltyStats(penaltyStats, car.id).seconds,
        vehicleSnapshotDependencies,
      )),
    };
  }

  snapshotRender() {
    const pitLaneStatus = pitLaneStatusSnapshot(this.raceControl, this.track.pitLane, this.rules.modules?.pitStops);
    const vehicleSnapshotDependencies = this.vehicleSnapshotDependencies();
    return {
      time: this.time,
      world: WORLD,
      track: this.track,
      totalLaps: this.totalLaps,
      raceControl: {
        mode: this.raceControl.mode,
        redFlag: Boolean(this.raceControl.redFlag),
        pitLaneOpen: pitLaneStatus.open,
        pitLaneStatus,
        finished: this.raceControl.finished,
        start: {
          ...this.raceControl.start,
          visible: this.raceControl.mode === 'pre-start' ||
            (this.raceControl.start.releasedAt != null && this.time - this.raceControl.start.releasedAt < 1.45),
        },
      },
      pitLaneStatus,
      safetyCar: { ...this.safetyCar },
      cars: this.orderedCars().map((car) => serializeVehicleRenderCar(car, vehicleSnapshotDependencies)),
    };
  }

  snapshotObservation() {
    const pitLaneStatus = pitLaneStatusSnapshot(this.raceControl, this.track.pitLane, this.rules.modules?.pitStops);
    const vehicleSnapshotDependencies = this.vehicleSnapshotDependencies();
    return {
      time: this.time,
      world: WORLD,
      track: this.track,
      totalLaps: this.totalLaps,
      raceControl: {
        mode: this.raceControl.mode,
        redFlag: Boolean(this.raceControl.redFlag),
        pitLaneOpen: pitLaneStatus.open,
        pitLaneStatus,
        finished: this.raceControl.finished,
      },
      pitLaneStatus,
      safetyCar: { ...this.safetyCar },
      events: [...this.events],
      cars: this.orderedCars().map((car, index) => serializeVehicleObservationCar(
        car,
        index + 1,
        vehicleSnapshotDependencies,
      )),
    };
  }

  consumeStepEvents() {
    return [...this.events];
  }

  orderedCars() {
    const sortLive = (cars) => [...cars].sort((a, b) => {
      const delta = b.raceDistance - a.raceDistance;
      return delta === 0 ? a.index - b.index : delta;
    });
    const byId = new Map(this.cars.map((car) => [car.id, car]));

    if (this.raceControl.finished && this.raceControl.classification?.length) {
      const classified = this.raceControl.classification.map((entry) => byId.get(entry.id)).filter(Boolean);
      const classifiedIds = new Set(classified.map((car) => car.id));
      return [
        ...classified,
        ...sortLive(this.cars.filter((car) => !classifiedIds.has(car.id))),
      ];
    }

    if (this.raceControl.finishOrder?.length) {
      const finished = this.raceControl.finishOrder.map((id) => byId.get(id)).filter(Boolean);
      const finishedIds = new Set(finished.map((car) => car.id));
      const missedFinished = this.cars
        .filter((car) => car.finished && !finishedIds.has(car.id))
        .sort((a, b) => {
          const delta = (a.finishRank ?? Infinity) - (b.finishRank ?? Infinity);
          return delta === 0 ? a.index - b.index : delta;
        });
      const running = sortLive(this.cars.filter((car) => !finishedIds.has(car.id) && !car.finished));
      return [...finished, ...missedFinished, ...running];
    }

    if (this.safetyCar.deployed && this.raceControl.frozenOrder?.length) {
      return this.raceControl.frozenOrder.map((id) => byId.get(id)).filter(Boolean);
    }

    return sortLive(this.cars);
  }

  driverRaceContext(orderedCars = this.orderedCars()) {
    return {
      track: this.track,
      cars: this.cars,
      orderedCars,
      safetyCar: this.safetyCar,
      rules: this.rules,
    };
  }

  computeAggression(car, orderIndex = Math.max(0, (car.rank ?? 1) - 1)) {
    const personality = car.personality ?? { baseAggression: 0.5, riskTolerance: 0.5, patience: 0.5 };
    if (this.safetyCar.deployed || car.canAttack === false) {
      return clamp(personality.baseAggression * 0.62, 0.08, 0.62);
    }

    const fieldDepth = Math.max(1, this.cars.length - 1);
    const positionPressure = clamp(orderIndex / fieldDepth, 0, 1);
    const gapPressure = Number.isFinite(car.gapAhead) ? clamp((230 - car.gapAhead) / 230, 0, 1) : 0;
    const tireConfidence = clamp(((car.tireEnergy ?? 100) - 42) / 58, 0, 1);
    const patienceDamping = (1 - gapPressure) * personality.patience * 0.08;

    return clamp(
      personality.baseAggression
        + positionPressure * 0.26
        + gapPressure * (0.1 + personality.riskTolerance * 0.08)
        - (1 - tireConfidence) * 0.1
        - patienceDamping,
      0.08,
      1,
    );
  }

  updateStartSequence() {
    return updateStartSequenceForSimulation(this);
  }

  releaseRaceStart() {
    return releaseRaceStartForSimulation(this);
  }

  holdGridCars() {
    return holdGridCarsForSimulation(this);
  }

  updateSafetyCar(dt) {
    updateSafetyCarState(this, dt);
  }

  moveSafetyCarTo(progress) {
    moveSafetyCarToState(this, progress);
  }

  applyRunoffResponse(car) {
    const state = nearestTrackState(this.track, car, car.progress);
    if (state.inPitLane) {
      applyWheelSurfaceState(car, this.track, { centerState: state });
      return;
    }
    const signedLimit = this.track.width / 2 + this.track.gravelWidth + this.track.runoffWidth;
    const overshoot = Math.abs(state.signedOffset) - signedLimit;
    if (overshoot <= 0) {
      applyWheelSurfaceState(car, this.track, { centerState: state });
      return;
    }

    const side = Math.sign(state.signedOffset) || 1;
    car.x -= state.normalX * side * overshoot;
    car.y -= state.normalY * side * overshoot;
    car.speed = clamp(car.speed * clamp(1 - overshoot * 0.012, 0.22, 0.86), 0, VEHICLE_LIMITS.maxSpeed);
    car.heading = normalizeAngle(car.heading - side * clamp(overshoot * 0.0028, 0.018, 0.08));
    applyWheelSurfaceState(car, this.track);
  }

  recalculateRaceState({ updateDrs = true } = {}) {
    this.cars.forEach((car) => {
      const previousRaceDistance = car.raceDistance;
      if (car.gridLocked) {
        const gridPoint = pointAt(this.track, car.gridDistance);
        applyWheelSurfaceState(car, this.track);
        car.progress = gridPoint.distance;
        car.raceDistance = car.gridDistance;
        car.lap = 1;
        resetLapTelemetry(car, this.time, this.track, this.totalLaps);
        return;
      }

      applyWheelSurfaceState(car, this.track);
      const previousProgress = car.progress ?? car.trackState.distance;
      const delta = progressDelta(car.trackState.distance, previousProgress, this.track.length);
      car.raceDistance = (car.raceDistance ?? previousProgress) + delta;
      car.progress = car.trackState.distance;
      car.lap = this.computeLap(car.raceDistance);
      updateLapTelemetry(car, previousRaceDistance, this.time, this.track, this.totalLaps);
    });

    updateSectorPerformance(this.cars);
    this.cars.forEach((car) => {
      recordTimingSample(car, this.time);
      recordTimingLineCrossings(car, car.previousRaceDistanceForTiming, this.time, this.track);
      car.previousRaceDistanceForTiming = car.raceDistance;
    });

    const ordered = this.orderedCars();
    const leader = ordered[0];
    ordered.forEach((car, index) => {
      const ahead = ordered[index - 1];
      const drsReference = this.getDrsReferenceCar(car);
      const gap = ahead ? ahead.raceDistance - car.raceDistance : Infinity;
      const intervalAheadLaps = ahead ? wholeLapGap(ahead.raceDistance, car.raceDistance, this.track.length) : 0;
      const leaderGapLaps = leader ? wholeLapGap(leader.raceDistance, car.raceDistance, this.track.length) : 0;
      const activePitStop = this.isCarInActivePitStop(car);
      car.rank = index + 1;
      car.gapAhead = gap;
      car.gapAheadLaps = intervalAheadLaps;
      car.intervalAheadLaps = intervalAheadLaps;
      car.leaderGapLaps = leaderGapLaps;
      car.gapAheadSeconds = Number.isFinite(gap) && intervalAheadLaps === 0
        ? estimateGapAheadSeconds(ahead, car, this.time, this.track)
        : Infinity;
      car.intervalAheadSeconds = car.gapAheadSeconds;
      car.leaderGapSeconds = leaderGapLaps > 0
        ? Infinity
        : (leader && leader !== car ? estimateGapAheadSeconds(leader, car, this.time, this.track) : 0);
      car.canAttack = !this.safetyCar.deployed && !car.finished && !activePitStop;
      car.aggression = this.computeAggression(car, index);
      if (activePitStop) {
        car.drsEligible = false;
        car.drsActive = false;
        car.drsZoneId = null;
        car.drsZoneEnabled = false;
      } else if (updateDrs) this.updateDrsLatch(car, drsReference, Boolean(drsReference));
    });
    this.evaluateRaceFinish();
  }

  evaluateRaceFinish() {
    if (this.raceControl.finished) return;
    if (this.raceControl.mode === 'pre-start') return;

    const ordered = this.orderedCars();
    const newlyFinished = ordered.filter((car) => !car.finished && car.raceDistance >= this.finishDistance);
    if (newlyFinished.length === 0) return;

    newlyFinished.forEach((car) => {
      car.finished = true;
      car.finishTime = this.time;
      car.finishRank = this.raceControl.finishOrder.length + 1;
      car.classifiedRank = car.finishRank;
      this.raceControl.finishOrder.push(car.id);
      if (!this.raceControl.winnerId) this.raceControl.winnerId = car.id;
      car.drsActive = false;
      car.drsEligible = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      car.canAttack = false;
      this.events.unshift({
        type: 'car-finish',
        at: this.time,
        carId: car.id,
        rank: car.finishRank,
        winnerId: this.raceControl.winnerId,
      });
      this.reviewTireRequirement(car);
    });

    if (!this.cars.every((car) => car.finished)) return;

    this.applyOutstandingServicePenalties();
    const classification = this.buildClassificationFromFinishOrder();
    this.raceControl.winnerId = classification[0]?.id ?? this.raceControl.winnerId;
    this.raceControl.mode = 'safety-car';
    this.raceControl.finished = true;
    this.raceControl.finishedAt = this.time;
    this.raceControl.classification = classification;
    this.raceControl.frozenOrder = classification.map((entry) => entry.id);
    this.safetyCar.deployed = true;
    const leader = this.cars.find((car) => car.id === this.raceControl.winnerId) ?? ordered[0];
    const safetyCarProgress = (leader?.raceDistance ?? 0) + this.rules.safetyCarLeadDistance;
    if (this.safetyCar.progress < safetyCarProgress) {
      this.moveSafetyCarTo(safetyCarProgress);
    }
    this.cars.forEach((car) => {
      const classified = classification.find((entry) => entry.id === car.id);
      car.classifiedRank = classified?.rank ?? car.rank;
      car.desiredOffset = 0;
      car.drsActive = false;
      car.drsEligible = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      car.canAttack = false;
    });
    this.events.unshift({
      type: 'race-finish',
      at: this.time,
      winnerId: this.raceControl.winnerId,
      classification: classification.map((entry) => ({ id: entry.id, rank: entry.rank })),
    });
  }

  applyOutstandingServicePenalties() {
    applyOutstandingServicePenaltiesState(this, applyUnservedServicePenalty);
  }

  buildClassificationFromFinishOrder() {
    return buildClassificationFromFinishOrderState(this);
  }

  applyClassificationConsequences(ordered, penaltyStats = this.getPenaltyStatsByDriver()) {
    return applyClassificationConsequencesState(this, ordered, penaltyStats);
  }

  buildClassification(ordered = this.orderedCars(), penaltyStats = this.getPenaltyStatsByDriver()) {
    return buildClassificationState(this, ordered, penaltyStats);
  }

  getRaceWinnerSnapshot() {
    if (!this.raceControl.winnerId) return null;
    const car = this.cars.find((item) => item.id === this.raceControl.winnerId);
    if (!car) return null;
    const rank = car.classifiedRank ?? car.rank ?? 1;
    return serializeVehicleCar(
      car,
      rank,
      getPenaltyStats(this.getPenaltyStatsByDriver(), car.id).seconds,
      this.vehicleSnapshotDependencies(),
    );
  }

  getDrsReferenceCar(car) {
    let closest = null;
    this.cars.forEach((candidate) => {
      if (candidate === car || candidate.finished || this.isCarInActivePitStop(candidate)) return;
      const delta = distanceForward(car.progress ?? car.raceDistance ?? 0, candidate.progress ?? candidate.raceDistance ?? 0, this.track.length);
      if (delta <= 0 || delta > this.track.length / 2) return;
      if (!closest || delta < closest.delta) closest = { car: candidate, delta };
    });
    return closest?.car ?? null;
  }

  updateDrsLatch(car, ahead, hasReference = Boolean(ahead)) {
    updateDrsLatchState(car, ahead, {
      hasReference,
      safetyCarDeployed: this.safetyCar.deployed,
      time: this.time,
      track: this.track,
      rules: this.rules,
    });
  }

  resolveCollisions() {
    const reportedContacts = new Set();

    for (let pass = 0; pass < 3; pass += 1) {
      const candidates = buildCollisionCandidatePairs(this.cars, { trackLength: this.track.length });
      for (const [first, second] of candidates) {
        const collision = detectVehicleCollision(first, second);
        if (!collision) continue;
        const firstPitControlled = isPitPositionControlledCar(first);
        const secondPitControlled = isPitPositionControlledCar(second);
        if (firstPitControlled && secondPitControlled) continue;
        const stewardCollision = createCollisionStewardContext(first, second, {
          ...collision,
          trackLength: this.track.length,
        });
        const oneCarFixed = firstPitControlled || secondPitControlled;

        const correction = Math.min(
          (oneCarFixed ? collision.depth : collision.depth / 2) + 0.65,
          MAX_COLLISION_CORRECTION,
        );
        const firstCorrectionX = firstPitControlled ? 0 : -collision.axis.x * correction;
        const firstCorrectionY = firstPitControlled ? 0 : -collision.axis.y * correction;
        const secondCorrectionX = secondPitControlled ? 0 : collision.axis.x * correction;
        const secondCorrectionY = secondPitControlled ? 0 : collision.axis.y * correction;
        if (!firstPitControlled) {
          first.x += firstCorrectionX;
          first.y += firstCorrectionY;
        }
        if (!secondPitControlled) {
          second.x += secondCorrectionX;
          second.y += secondCorrectionY;
        }

        if (oneCarFixed) {
          if (!firstPitControlled) first.speed = clamp(first.speed * 0.985, 0, VEHICLE_LIMITS.maxSpeed);
          if (!secondPitControlled) second.speed = clamp(second.speed * 0.985, 0, VEHICLE_LIMITS.maxSpeed);
        } else {
          this.applyContactVelocityResponse(first, second, collision.axis);
        }

        const yawNudge = clamp(collision.depth * 0.0025, 0.008, 0.035);
        const freshContact = first.contactCooldown <= 0 && second.contactCooldown <= 0;
        const firstHeadingCorrection = firstPitControlled ? 0 : -collision.axis.y * yawNudge;
        const secondHeadingCorrection = secondPitControlled ? 0 : collision.axis.y * yawNudge;
        if (!firstPitControlled) {
          first.heading = normalizeAngle(first.heading + firstHeadingCorrection);
          shiftPreviousRenderPose(first, firstCorrectionX, firstCorrectionY, firstHeadingCorrection);
        }
        if (!secondPitControlled) {
          second.heading = normalizeAngle(second.heading + secondHeadingCorrection);
          shiftPreviousRenderPose(second, secondCorrectionX, secondCorrectionY, secondHeadingCorrection);
        }
        first.contactCooldown = 1;
        second.contactCooldown = 1;

        const contactKey = `${first.id}:${second.id}`;
        if (freshContact && pass === 0 && !reportedContacts.has(contactKey)) {
          reportedContacts.add(contactKey);
          this.events.unshift({
            type: 'contact',
            at: this.time,
            carId: first.id,
            otherCarId: second.id,
            firstShapeId: collision.firstShapeId,
            secondShapeId: collision.secondShapeId,
            contactType: collision.contactType,
            depth: collision.depth,
            timeOfImpact: collision.timeOfImpact,
          });
          this.reviewCollision(first, second, stewardCollision);
        }
      }
    }
  }

  applyContactVelocityResponse(first, second, axis) {
    const firstForward = forwardVector(first);
    const secondForward = forwardVector(second);
    const firstNormal = dot(firstForward, axis);
    const secondNormal = dot(secondForward, axis);
    const relativeNormalVelocity = second.speed * secondNormal - first.speed * firstNormal;

    if (relativeNormalVelocity < 0) {
      const impulse = clamp(-relativeNormalVelocity * (0.34 + this.rules.collisionRestitution), 0, 16);
      if (firstNormal > 0) first.speed = clamp(first.speed - impulse * firstNormal, 0, VEHICLE_LIMITS.maxSpeed);
      if (secondNormal < 0) second.speed = clamp(second.speed + impulse * secondNormal, 0, VEHICLE_LIMITS.maxSpeed);
    }

    first.speed = clamp(first.speed * 0.997, 0, VEHICLE_LIMITS.maxSpeed);
    second.speed = clamp(second.speed * 0.997, 0, VEHICLE_LIMITS.maxSpeed);
  }

  computeLap(raceDistance) {
    return clamp(Math.floor(Math.max(0, raceDistance) / this.track.length) + 1, 1, this.totalLaps);
  }

  get finishDistance() {
    return this.track.length * this.totalLaps;
  }
}

export function createRaceSimulation(options = {}) {
  return new F1RaceSimulation(options);
}
