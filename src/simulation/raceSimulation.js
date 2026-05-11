import {
  applyUnservedServicePenalty,
  cancelPenaltyRecord,
  createPenaltyEvent,
  createPenaltyRecord,
  servePenaltyRecord,
} from './rules/penaltyLedger.js';
import { createPenaltyCancelledEvent, createPenaltyServedEvent } from './rules/penaltyEvents.js';
import { buildPenaltyStatsByDriver, getPenaltyStats } from './rules/penaltyStats.js';
import {
  reviewCollisionForSimulation,
  reviewPitLaneSpeedingForSimulation,
  reviewTireRequirementForSimulation,
  reviewTrackLimitsForSimulation,
} from './rules/rulesReview.js';
import { DEFAULT_RULES } from './rulesConfig.js';
import { applyExternalCarState } from './vehicle/vehicleState.js';
import {
  applyContactVelocityResponse as applyContactVelocityResponseForSimulation,
  resolveCollisionsForSimulation,
} from './vehicle/contactResolution.js';
import { applyRunoffResponseForSimulation } from './vehicle/runoffResponse.js';
import { resetLapTelemetry, resetTimingHistory, resetTimingLineCrossings } from './timing/raceTiming.js';
import { updateDrsLatch as updateDrsLatchState } from './timing/drsTiming.js';
import {
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
import { nearestDistanceOnRoute } from './pit/pitRouting.js';
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
import {
  computeLapForDistance,
  finishDistanceForRace,
  progressDelta,
} from './race/raceDistance.js';
import { recalculateRaceStateForSimulation } from './race/raceProgress.js';
import { evaluateRaceFinishForSimulation } from './race/raceFinish.js';
import { applyGridDropForSimulation } from './race/gridPenalties.js';
import { initializeRaceSimulation, normalizePitIntentForRace } from './race/raceSetup.js';
import { runRaceStep } from './race/raceStep.js';
import {
  createVehicleSnapshotDependencies,
  getRaceWinnerSnapshot as getRaceWinnerSnapshotForSimulation,
  snapshotRace,
  snapshotRaceObservation,
  snapshotRaceRender,
  snapshotRaceTraining,
} from './snapshots/raceSnapshots.js';

export const FIXED_STEP = 1 / 60;

export { DEFAULT_RULES };

export class F1RaceSimulation {
  constructor(options = {}) {
    initializeRaceSimulation(this, options);
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
    this.setCarStates({ [id]: partial });
  }

  setCarStates(partialsById = {}) {
    const context = {
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
    };
    let applied = false;
    Object.entries(partialsById).forEach(([id, partial]) => {
      const car = this.cars.find((item) => item.id === id);
      if (!car) return;
      applyExternalCarState(car, partial, context);
      applied = true;
    });
    if (!applied) return;
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
    return normalizePitIntentForRace(car);
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
    runRaceStep(this, dt);
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
      this.events.unshift(createPenaltyServedEvent(result, this.time));
    }
    return result;
  }

  cancelPenalty(penaltyId) {
    const penalty = this.penalties.find((entry) => entry.id === penaltyId);
    const result = cancelPenaltyRecord(penalty, this.time);
    if (result) {
      this.events.unshift(createPenaltyCancelledEvent(result, this.time));
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
    applyGridDropForSimulation(this, driverId, positions);
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

  snapshotTraining() {
    return snapshotRaceTraining(this);
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
