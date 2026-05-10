import { WORLD } from '../track/trackModel.js';
import { simSpeedToKph, simUnitsToMeters } from '../units.js';
import { VEHICLE_LIMITS } from '../vehicle/vehiclePhysics.js';
import { serializePenalty } from '../rules/penaltyLedger.js';
import { normalizePitIntent, PIT_INTENT_NONE } from '../pit/pitIntent.js';
import {
  pitLaneStatusSnapshot,
  serializeObservationPitStop,
  serializePitStop,
  serializeRenderPitStop,
} from '../pit/pitSnapshots.js';
import {
  serializeCar,
  serializeObservationCar,
  serializeRenderCar,
} from '../vehicle/vehicleSnapshots.js';
import { createLapTelemetry, serializeLapTelemetry } from '../timing/raceTiming.js';

function visibleStartState(sim) {
  return {
    ...sim.raceControl.start,
    visible: sim.raceControl.mode === 'pre-start' ||
      (sim.raceControl.start.releasedAt != null && sim.time - sim.raceControl.start.releasedAt < 1.45),
  };
}

function penaltySecondsFor(statsByDriver, driverId) {
  return statsByDriver.get(driverId)?.seconds ?? 0;
}

export function createVehicleSnapshotDependencies(sim) {
  return {
    createLapTelemetry,
    normalizePitIntent,
    PIT_INTENT_NONE,
    serializeLapTelemetry,
    serializeObservationPitStop: (pitStop) => serializeObservationPitStop(
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

export function snapshotRace(sim) {
  const ordered = sim.orderedCars();
  const pitLaneStatus = pitLaneStatusSnapshot(sim.raceControl, sim.track.pitLane, sim.rules.modules?.pitStops);
  const penaltyStats = sim.getPenaltyStatsByDriver();
  const vehicleSnapshotDependencies = createVehicleSnapshotDependencies(sim);
  return {
    time: sim.time,
    world: WORLD,
    track: sim.track,
    totalLaps: sim.totalLaps,
    raceControl: {
      mode: sim.raceControl.mode,
      redFlag: Boolean(sim.raceControl.redFlag),
      pitLaneOpen: pitLaneStatus.open,
      pitLaneStatus,
      finished: sim.raceControl.finished,
      finishedAt: sim.raceControl.finishedAt,
      winner: getRaceWinnerSnapshot(sim),
      classification: sim.raceControl.classification.map((entry) => ({ ...entry })),
      start: visibleStartState(sim),
    },
    pitLaneStatus,
    safetyCar: { ...sim.safetyCar },
    rules: sim.rules,
    events: [...sim.events],
    penalties: sim.penalties.map(serializePenalty),
    cars: ordered.map((car, index) => serializeCar(
      car,
      index + 1,
      penaltySecondsFor(penaltyStats, car.id),
      vehicleSnapshotDependencies,
    )),
  };
}

export function snapshotRaceRender(sim) {
  const pitLaneStatus = pitLaneStatusSnapshot(sim.raceControl, sim.track.pitLane, sim.rules.modules?.pitStops);
  const vehicleSnapshotDependencies = createVehicleSnapshotDependencies(sim);
  return {
    time: sim.time,
    world: WORLD,
    track: sim.track,
    totalLaps: sim.totalLaps,
    raceControl: {
      mode: sim.raceControl.mode,
      redFlag: Boolean(sim.raceControl.redFlag),
      pitLaneOpen: pitLaneStatus.open,
      pitLaneStatus,
      finished: sim.raceControl.finished,
      start: visibleStartState(sim),
    },
    pitLaneStatus,
    safetyCar: { ...sim.safetyCar },
    cars: sim.orderedCars().map((car) => serializeRenderCar(car, vehicleSnapshotDependencies)),
  };
}

export function snapshotRaceObservation(sim) {
  const pitLaneStatus = pitLaneStatusSnapshot(sim.raceControl, sim.track.pitLane, sim.rules.modules?.pitStops);
  const vehicleSnapshotDependencies = createVehicleSnapshotDependencies(sim);
  return {
    time: sim.time,
    world: WORLD,
    track: sim.track,
    totalLaps: sim.totalLaps,
    raceControl: {
      mode: sim.raceControl.mode,
      redFlag: Boolean(sim.raceControl.redFlag),
      pitLaneOpen: pitLaneStatus.open,
      pitLaneStatus,
      finished: sim.raceControl.finished,
    },
    pitLaneStatus,
    safetyCar: { ...sim.safetyCar },
    events: [...sim.events],
    cars: sim.orderedCars().map((car, index) => serializeObservationCar(
      car,
      index + 1,
      vehicleSnapshotDependencies,
    )),
  };
}

export function getRaceWinnerSnapshot(sim) {
  if (!sim.raceControl.winnerId) return null;
  const car = sim.cars.find((item) => item.id === sim.raceControl.winnerId);
  if (!car) return null;
  const rank = car.classifiedRank ?? car.rank ?? 1;
  return serializeCar(
    car,
    rank,
    penaltySecondsFor(sim.getPenaltyStatsByDriver(), car.id),
    createVehicleSnapshotDependencies(sim),
  );
}
