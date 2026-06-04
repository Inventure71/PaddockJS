import { pointAt } from '../track/trackModel.js';
import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import {
  clearRunoffCenterState,
  takeValidRunoffCenterState,
} from '../vehicle/runoffResponse.js';
import { affectsRaceOrder } from '../participants/participantInteractions.js';
import {
  estimateGapAheadSeconds,
  recordTimingLineCrossings,
  recordTimingSample,
  resetLapTelemetry,
  updateLapTelemetry,
  updateSectorPerformance,
  wholeLapGap,
} from '../timing/raceTiming.js';
import { progressDelta } from './raceDistance.js';
import { assignDrsReferenceCarsForSimulation } from './raceOrder.js';
import { isRaceDnf } from './retirements.js';
import { freezeVehicleMotion } from '../vehicle/vehicleKinematics.js';

export function refreshLocalRaceStateForSimulation(sim) {
  sim.cars.forEach((car) => {
    if (car.destroyed || car.outOfRace) {
      clearRunoffCenterState(car);
      applyWheelSurfaceState(car, sim.track);
      freezeVehicleMotion(car, {
        clearManualControls: true,
        physicsMode: sim.physicsMode,
        stabilityState: car.destroyed ? 'destroyed' : car.stabilityState,
      });
      car.canAttack = false;
      car.drsEligible = false;
      car.drsActive = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      return;
    }
    const centerState = takeValidRunoffCenterState(car);
    if (centerState) {
      applyWheelSurfaceState(car, sim.track, { centerState, cacheAsAuto: true });
    } else {
      applyWheelSurfaceState(car, sim.track);
    }
  });
}

function resolveLeaderGapSeconds({
  sim,
  leader,
  ahead,
  car,
  leaderGapLaps,
  gapAheadSeconds,
  currentTime,
  track,
}) {
  if (leaderGapLaps > 0) return Infinity;
  if (!leader || leader === car) return 0;
  if (!ahead) return Infinity;
  if (ahead === leader) {
    if (sim?.runtimeBenchmarkStats) {
      sim.runtimeBenchmarkStats.leaderGapAccumulated = (sim.runtimeBenchmarkStats.leaderGapAccumulated ?? 0) + 1;
    }
    return gapAheadSeconds;
  }
  if (Number.isFinite(gapAheadSeconds) && Number.isFinite(ahead.leaderGapSeconds)) {
    if (sim?.runtimeBenchmarkStats) {
      sim.runtimeBenchmarkStats.leaderGapAccumulated = (sim.runtimeBenchmarkStats.leaderGapAccumulated ?? 0) + 1;
    }
    return ahead.leaderGapSeconds + gapAheadSeconds;
  }
  if (sim?.runtimeBenchmarkStats) {
    sim.runtimeBenchmarkStats.leaderGapFallbackEstimates = (sim.runtimeBenchmarkStats.leaderGapFallbackEstimates ?? 0) + 1;
  }
  return estimateGapAheadSeconds(leader, car, currentTime, track);
}

function recordTimingStateForCar(car, currentTime, track, previousRaceDistanceForTiming, runtimeBenchmarkStats) {
  recordTimingSample(car, currentTime);
  recordTimingLineCrossings(car, previousRaceDistanceForTiming, currentTime, track);
  car.previousRaceDistanceForTiming = car.raceDistance;
  if (runtimeBenchmarkStats) {
    runtimeBenchmarkStats.timingStateUpdates = (runtimeBenchmarkStats.timingStateUpdates ?? 0) + 1;
  }
}

export function recalculateRaceStateForSimulation(sim, { updateDrs = true, refreshSurfaces = true } = {}) {
  let sectorPerformanceDirty = false;
  sim.cars.forEach((car) => {
    const previousRaceDistance = car.raceDistance;
    const previousRaceDistanceForTiming = car.previousRaceDistanceForTiming;
    if (car.destroyed || car.outOfRace) {
      if (refreshSurfaces) applyWheelSurfaceState(car, sim.track);
      freezeVehicleMotion(car, {
        clearManualControls: true,
        physicsMode: sim.physicsMode,
        stabilityState: car.destroyed ? 'destroyed' : car.stabilityState,
      });
      car.canAttack = false;
      car.drsEligible = false;
      car.drsActive = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      recordTimingStateForCar(car, sim.time, sim.track, previousRaceDistanceForTiming, sim.runtimeBenchmarkStats);
      return;
    }
    if (car.gridLocked) {
      const gridPoint = pointAt(sim.track, car.gridDistance);
      if (refreshSurfaces) applyWheelSurfaceState(car, sim.track);
      car.progress = gridPoint.distance;
      car.raceDistance = car.gridDistance;
      car.lap = 1;
      resetLapTelemetry(car, sim.time, sim.track, sim.totalLaps);
      sectorPerformanceDirty = true;
      recordTimingStateForCar(car, sim.time, sim.track, previousRaceDistanceForTiming, sim.runtimeBenchmarkStats);
      return;
    }

    if (refreshSurfaces) applyWheelSurfaceState(car, sim.track);
    const previousProgress = car.progress ?? car.trackState.distance;
    const delta = progressDelta(car.trackState.distance, previousProgress, sim.track.length);
    car.raceDistance = (car.raceDistance ?? previousProgress) + delta;
    car.progress = car.trackState.distance;
    car.lap = sim.computeLap(car.raceDistance);
    sectorPerformanceDirty = updateLapTelemetry(car, previousRaceDistance, sim.time, sim.track, sim.totalLaps) || sectorPerformanceDirty;
    recordTimingStateForCar(car, sim.time, sim.track, previousRaceDistanceForTiming, sim.runtimeBenchmarkStats);
  });

  if (sectorPerformanceDirty) {
    sim.runtimeBenchmarkStats && (sim.runtimeBenchmarkStats.sectorPerformanceDirtyCommits = (sim.runtimeBenchmarkStats.sectorPerformanceDirtyCommits ?? 0) + 1);
  }
  updateSectorPerformance(sim.cars, sim.runtimeBenchmarkStats);

  const ordered = sim.orderedCars();
  const drsReferenceByIndex = updateDrs ? assignDrsReferenceCarsForSimulation(sim, ordered) : null;
  if (ordered.length !== sim.cars.length) {
    if (sim?.runtimeBenchmarkStats) {
      sim.runtimeBenchmarkStats.excludedCarResetScans = (sim.runtimeBenchmarkStats.excludedCarResetScans ?? 0) + 1;
    }
    sim.cars.forEach((car) => {
      if (affectsRaceOrder(car)) return;
      car.rank = null;
      car.classifiedRank = null;
      car.gapAhead = Infinity;
      car.gapAheadLaps = 0;
      car.intervalAheadLaps = 0;
      car.leaderGapLaps = 0;
      car.gapAheadSeconds = Infinity;
      car.intervalAheadSeconds = Infinity;
      car.leaderGapSeconds = Infinity;
      car.drsEligible = false;
      car.drsActive = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      car.canAttack = false;
    });
  } else if (sim?.runtimeBenchmarkStats) {
    sim.runtimeBenchmarkStats.excludedCarResetSkips = (sim.runtimeBenchmarkStats.excludedCarResetSkips ?? 0) + 1;
  }
  const leader = ordered[0];
  let liveRaceOrderCount = ordered.length;
  while (liveRaceOrderCount > 0 && isRaceDnf(ordered[liveRaceOrderCount - 1])) {
    liveRaceOrderCount -= 1;
  }
  const aggressionFieldDepth = Math.max(1, liveRaceOrderCount - 1);
  ordered.forEach((car, index) => {
    if (isRaceDnf(car)) {
      car.rank = index + 1;
      car.classifiedRank = null;
      car.gapAhead = Infinity;
      car.gapAheadLaps = 0;
      car.intervalAheadLaps = 0;
      car.leaderGapLaps = 0;
      car.gapAheadSeconds = Infinity;
      car.intervalAheadSeconds = Infinity;
      car.leaderGapSeconds = Infinity;
      car.drsEligible = false;
      car.drsActive = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      car.canAttack = false;
      return;
    }
    const ahead = ordered[index - 1];
    const drsReference = drsReferenceByIndex?.[car.index] ?? null;
    const gap = ahead ? ahead.raceDistance - car.raceDistance : Infinity;
    const intervalAheadLaps = ahead ? wholeLapGap(ahead.raceDistance, car.raceDistance, sim.track.length) : 0;
    const leaderGapLaps = leader ? wholeLapGap(leader.raceDistance, car.raceDistance, sim.track.length) : 0;
    const activePitStop = sim.isCarInActivePitStop(car);
    car.rank = index + 1;
    car.gapAhead = gap;
    car.gapAheadLaps = intervalAheadLaps;
    car.intervalAheadLaps = intervalAheadLaps;
    car.leaderGapLaps = leaderGapLaps;
    car.gapAheadSeconds = Number.isFinite(gap) && intervalAheadLaps === 0
      ? estimateGapAheadSeconds(ahead, car, sim.time, sim.track)
      : Infinity;
    car.intervalAheadSeconds = car.gapAheadSeconds;
    car.leaderGapSeconds = resolveLeaderGapSeconds({
      sim,
      leader,
      ahead,
      car,
      leaderGapLaps,
      gapAheadSeconds: car.gapAheadSeconds,
      currentTime: sim.time,
      track: sim.track,
    });
    car.canAttack = !sim.safetyCar.deployed && !car.finished && !activePitStop;
    car.aggression = sim.computeAggression(car, index, aggressionFieldDepth);
    if (activePitStop) {
      car.drsEligible = false;
      car.drsActive = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
    } else if (updateDrs) sim.updateDrsLatch(car, drsReference, Boolean(drsReference));
  });
  sim.evaluateRaceFinish(ordered);
  return ordered;
}
