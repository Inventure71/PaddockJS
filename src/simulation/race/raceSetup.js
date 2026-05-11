import { buildTrackModel, createProceduralTrack, TRACK } from '../track/trackModel.js';
import { attachTrackQueryIndex, createTrackQueryIndex } from '../track/trackQueryIndex.js';
import { createMulberry32 } from '../simMath.js';
import { createCar } from '../vehicle/vehicleState.js';
import { normalizePhysicsMode } from '../vehicle/vehiclePhysics.js';
import {
  createLapTelemetry,
  createTimingLines,
  resetLapTelemetry,
  resetTimingHistory,
  resetTimingLineCrossings,
} from '../timing/raceTiming.js';
import { normalizePitIntent, PIT_INTENT_NONE } from '../pit/pitIntent.js';
import { assignPitLaneTeams, initializePitStops } from '../pit/pitState.js';
import { clonePitLaneModel } from '../pit/pitRouting.js';
import { createRaceControlState, createSafetyCarState } from './raceControlState.js';
import { normalizeTotalLaps } from './raceDistance.js';
import { normalizeRaceRules } from '../rulesConfig.js';
import { attachParticipantInteractions } from '../participants/participantInteractions.js';
import { normalizeReplayGhosts, updateReplayGhosts } from '../replay/replayGhosts.js';

export const DEFAULT_TOTAL_LAPS = 10;

export function initializeRaceSimulation(simulation, {
  seed = 1,
  drivers = [],
  totalLaps = DEFAULT_TOTAL_LAPS,
  rules = {},
  track = null,
  trackSeed = null,
  trackQueryIndex = false,
  physicsMode = 'arcade',
  participantInteractions = {},
  replayGhosts = [],
} = {}) {
  simulation.seed = seed;
  simulation.random = createMulberry32(seed);
  simulation.physicsMode = normalizePhysicsMode(physicsMode);
  const trackDefinition = track ?? (trackSeed == null ? TRACK : createProceduralTrack(trackSeed));
  const builtTrack = buildTrackModel(trackDefinition);
  simulation.track = {
    ...builtTrack,
    pitLane: clonePitLaneModel(builtTrack.pitLane),
  };
  if (trackQueryIndex) {
    attachTrackQueryIndex(simulation.track, createTrackQueryIndex(simulation.track));
  }
  simulation.track.timingLines = createTimingLines(simulation.track);
  simulation.trackSeed = simulation.track.seed ?? trackSeed;
  simulation.rules = normalizeRaceRules(rules);
  simulation.startLightsOutAt = simulation.rules.startLightCount * simulation.rules.startLightInterval +
    simulation.rules.startLightsOutHold;
  simulation.totalLaps = normalizeTotalLaps(totalLaps);
  simulation.time = 0;
  simulation.events = [];
  simulation.penalties = [];
  simulation.nextPenaltyId = 1;
  simulation.stewardState = {
    trackLimits: Object.create(null),
    pitLaneSpeeding: Object.create(null),
    tireRequirement: Object.create(null),
  };
  simulation.raceControl = createRaceControlState(simulation.rules, simulation.startLightsOutAt);
  simulation.safetyCar = createSafetyCarState(simulation.track, simulation.rules);
  simulation.cars = drivers.map((driver, index) => createCar(driver, index, simulation.random, simulation.track, {
    standingStart: simulation.raceControl.mode === 'pre-start',
    createLapTelemetry,
  }));
  simulation.participantInteractions = attachParticipantInteractions(simulation.cars, participantInteractions);
  simulation.replayGhosts = normalizeReplayGhosts(replayGhosts);
  updateReplayGhosts(simulation.replayGhosts, simulation.time);
  assignPitLaneTeams({ cars: simulation.cars, pitLane: simulation.track.pitLane });
  initializePitStops({
    cars: simulation.cars,
    pitLane: simulation.track.pitLane,
    pitStops: simulation.rules.modules?.pitStops,
    totalLaps: simulation.totalLaps,
    trackLength: simulation.track.length,
    tireCompounds: simulation.rules.modules?.tireStrategy?.compounds,
    PIT_INTENT_NONE,
  });
  simulation.recalculateRaceState({ updateDrs: false });
  simulation.cars.forEach((car) => resetTimingHistory(car, simulation.time));
  simulation.cars.forEach((car) => resetTimingLineCrossings(car, simulation.time));
  simulation.cars.forEach((car) => resetLapTelemetry(car, simulation.time, simulation.track, simulation.totalLaps));
}

export function normalizePitIntentForRace(car) {
  return normalizePitIntent(car?.pitStop?.intent) ?? PIT_INTENT_NONE;
}
