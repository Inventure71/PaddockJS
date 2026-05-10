import {
  buildTrackModel,
  createProceduralTrack,
  offsetTrackPoint,
  pointAt,
  TRACK,
} from './trackModel.js';
import { decideDriverControls } from './driverController.js';
import {
  applyUnservedServicePenalty,
  cancelPenaltyRecord,
  createPenaltyEvent,
  createPenaltyRecord,
  servePenaltyRecord,
} from './rules/penaltyLedger.js';
import { buildPenaltyStatsByDriver, getPenaltyStats } from './rules/penaltyStats.js';
import {
  reviewCollisionForSimulation,
  reviewPitLaneSpeedingForSimulation,
  reviewTireRequirementForSimulation,
  reviewTrackLimitsForSimulation,
} from './rules/rulesReview.js';
import { DEFAULT_RULES, normalizeRaceRules } from './rulesConfig.js';
import { clamp, createMulberry32 } from './simMath.js';
import { integrateVehiclePhysics } from './vehiclePhysics.js';
import { applyWheelSurfaceState } from './wheelSurface.js';
import { applyExternalCarState, createCar, getStartGridSlot } from './vehicle/vehicleState.js';
import {
  applyContactVelocityResponse as applyContactVelocityResponseForSimulation,
  resolveCollisionsForSimulation,
} from './vehicle/contactResolution.js';
import { applyRunoffResponseForSimulation } from './vehicle/runoffResponse.js';
import {
  createLapTelemetry,
  createTimingLines,
  resetLapTelemetry,
  resetTimingHistory,
  resetTimingLineCrossings,
} from './timing/raceTiming.js';
import { updateDrsLatch as updateDrsLatchState } from './timing/drsTiming.js';
import {
  normalizePitIntent,
  PIT_INTENT_NONE,
  setPitIntentForSimulation,
} from './pit/pitIntent.js';
import { assignPitLaneTeams as assignPitLaneTeamsState, initializePitStops as initializePitStopsState } from './pit/pitState.js';
import {
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
  advancePitStopCar as advancePitStopCarForSimulation,
  canStartPitStop as canStartPitStopForSimulation,
  isCarInActivePitStop as isCarInActivePitStopForSimulation,
  isPitLaneOpenForStops as isPitLaneOpenForStopsForSimulation,
  pitEntryLateThresholdDistance as pitEntryLateThresholdDistanceForSimulation,
  rearmCompletedPitStop as rearmCompletedPitStopForSimulation,
  schedulePitStopAtNextEntry as schedulePitStopAtNextEntryForSimulation,
  shouldStartPitStop as shouldStartPitStopForSimulation,
  startPitStop as startPitStopForSimulation,
  updateAutomaticPitIntent as updateAutomaticPitIntentForSimulation,
} from './pit/pitFlow.js';
import {
  clonePitLaneModel,
  nearestDistanceOnRoute,
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
import {
  computeAggressionForSimulation,
  driverRaceContextForSimulation,
  getDrsReferenceCarForSimulation,
  orderedCarsForSimulation,
} from './race/raceOrder.js';
import { createRaceControlState, createSafetyCarState } from './race/raceControlState.js';
import {
  computeLapForDistance,
  finishDistanceForRace,
  normalizeTotalLaps,
  progressDelta,
} from './race/raceDistance.js';
import { recalculateRaceStateForSimulation } from './race/raceProgress.js';
import { evaluateRaceFinishForSimulation } from './race/raceFinish.js';
import { applyRedFlagHoldForSimulation } from './race/redFlag.js';
import {
  createVehicleSnapshotDependencies,
  getRaceWinnerSnapshot as getRaceWinnerSnapshotForSimulation,
  snapshotRace,
  snapshotRaceObservation,
  snapshotRaceRender,
} from './snapshots/raceSnapshots.js';

const DEFAULT_TOTAL_LAPS = 10;
export const FIXED_STEP = 1 / 60;

export { DEFAULT_RULES };

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
    this.raceControl = createRaceControlState(this.rules, this.startLightsOutAt);
    this.safetyCar = createSafetyCarState(this.track, this.rules);
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
    return isCarInActivePitStopForSimulation(this, car);
  }

  schedulePitStopAtNextEntry(car, stop) {
    return schedulePitStopAtNextEntryForSimulation(this, car, stop);
  }

  rearmCompletedPitStop(car, stop) {
    return rearmCompletedPitStopForSimulation(this, car, stop);
  }

  canStartPitStop(car) {
    return canStartPitStopForSimulation(this, car);
  }

  shouldStartPitStop(car) {
    return shouldStartPitStopForSimulation(this, car);
  }

  updateAutomaticPitIntent(car) {
    return updateAutomaticPitIntentForSimulation(this, car);
  }

  isPitLaneOpenForStops() {
    return isPitLaneOpenForStopsForSimulation(this);
  }

  pitEntryLateThresholdDistance() {
    return pitEntryLateThresholdDistanceForSimulation();
  }

  getPitStopBox(stop) {
    return getPitStopBoxForSimulation(this, stop);
  }

  isPitServiceBusy(car, box) {
    return isPitServiceBusyForSimulation(this, car, box);
  }

  isPitServiceAreaOccupied(candidate, box) {
    return isPitServiceAreaOccupiedForSimulation(this, candidate, box);
  }

  isPitServiceQueueOccupied(car, box) {
    return isPitServiceQueueOccupiedForSimulation(this, car, box);
  }

  getPitBoxRaceDistance(stop, box) {
    return getPitBoxRaceDistanceForSimulation(this, stop, box);
  }

  startPitStop(car) {
    return startPitStopForSimulation(this, car);
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
    return advancePitStopCarForSimulation(this, car, delta);
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
      applyRedFlagHoldForSimulation(this);
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
    reviewCollisionForSimulation(this, first, second, collision);
  }

  reviewTireRequirement(car) {
    if (this.stewardState.tireRequirement[car.id]) return;
    this.stewardState.tireRequirement[car.id] = true;
    reviewTireRequirementForSimulation(this, car);
  }

  reviewTrackLimits() {
    reviewTrackLimitsForSimulation(this);
  }

  reviewPitLaneSpeeding() {
    reviewPitLaneSpeedingForSimulation(this);
  }

  vehicleSnapshotDependencies() {
    return createVehicleSnapshotDependencies(this);
  }

  snapshot() {
    return snapshotRace(this);
  }

  snapshotRender() {
    return snapshotRaceRender(this);
  }

  snapshotObservation() {
    return snapshotRaceObservation(this);
  }

  consumeStepEvents() {
    return [...this.events];
  }

  orderedCars() {
    return orderedCarsForSimulation(this);
  }

  driverRaceContext(orderedCars = this.orderedCars()) {
    return driverRaceContextForSimulation(this, orderedCars);
  }

  computeAggression(car, orderIndex = Math.max(0, (car.rank ?? 1) - 1)) {
    return computeAggressionForSimulation(this, car, orderIndex);
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
    applyRunoffResponseForSimulation(this, car);
  }

  recalculateRaceState({ updateDrs = true } = {}) {
    recalculateRaceStateForSimulation(this, { updateDrs });
  }

  evaluateRaceFinish() {
    evaluateRaceFinishForSimulation(this);
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
    return getRaceWinnerSnapshotForSimulation(this);
  }

  getDrsReferenceCar(car) {
    return getDrsReferenceCarForSimulation(this, car);
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
    resolveCollisionsForSimulation(this);
  }

  applyContactVelocityResponse(first, second, axis) {
    applyContactVelocityResponseForSimulation(this, first, second, axis);
  }

  computeLap(raceDistance) {
    return computeLapForDistance(raceDistance, this.track.length, this.totalLaps);
  }

  get finishDistance() {
    return finishDistanceForRace(this.track.length, this.totalLaps);
  }
}

export function createRaceSimulation(options = {}) {
  return new F1RaceSimulation(options);
}
