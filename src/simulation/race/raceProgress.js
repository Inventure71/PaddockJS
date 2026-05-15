import { pointAt } from '../track/trackModel.js';
import { applyWheelSurfaceState } from '../vehicle/wheelSurface.js';
import {
  affectsRaceOrder,
} from '../participants/participantInteractions.js';
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
import { isRaceDnf } from './retirements.js';

export function recalculateRaceStateForSimulation(sim, { updateDrs = true } = {}) {
  sim.cars.forEach((car) => {
    const previousRaceDistance = car.raceDistance;
    if (car.destroyed) {
      applyWheelSurfaceState(car, sim.track);
      car.speed = 0;
      car.canAttack = false;
      car.drsEligible = false;
      car.drsActive = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
      return;
    }
    if (car.gridLocked) {
      const gridPoint = pointAt(sim.track, car.gridDistance);
      applyWheelSurfaceState(car, sim.track);
      car.progress = gridPoint.distance;
      car.raceDistance = car.gridDistance;
      car.lap = 1;
      resetLapTelemetry(car, sim.time, sim.track, sim.totalLaps);
      return;
    }

    applyWheelSurfaceState(car, sim.track);
    const previousProgress = car.progress ?? car.trackState.distance;
    const delta = progressDelta(car.trackState.distance, previousProgress, sim.track.length);
    car.raceDistance = (car.raceDistance ?? previousProgress) + delta;
    car.progress = car.trackState.distance;
    car.lap = sim.computeLap(car.raceDistance);
    updateLapTelemetry(car, previousRaceDistance, sim.time, sim.track, sim.totalLaps);
  });

  updateSectorPerformance(sim.cars);
  sim.cars.forEach((car) => {
    recordTimingSample(car, sim.time);
    recordTimingLineCrossings(car, car.previousRaceDistanceForTiming, sim.time, sim.track);
    car.previousRaceDistanceForTiming = car.raceDistance;
  });

  const ordered = sim.orderedCars();
  const orderedIds = new Set(ordered.map((car) => car.id));
  sim.cars.forEach((car) => {
    if (orderedIds.has(car.id) || affectsRaceOrder(car)) return;
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
  const leader = ordered[0];
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
    const drsReference = sim.getDrsReferenceCar(car);
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
    car.leaderGapSeconds = leaderGapLaps > 0
      ? Infinity
      : (leader && leader !== car ? estimateGapAheadSeconds(leader, car, sim.time, sim.track) : 0);
    car.canAttack = !sim.safetyCar.deployed && !car.finished && !activePitStop;
    car.aggression = sim.computeAggression(car, index);
    if (activePitStop) {
      car.drsEligible = false;
      car.drsActive = false;
      car.drsZoneId = null;
      car.drsZoneEnabled = false;
    } else if (updateDrs) sim.updateDrsLatch(car, drsReference, Boolean(drsReference));
  });
  sim.evaluateRaceFinish();
  return ordered;
}
