import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { handleActionError, resolveActionMap } from './actions.js';
import { collectStepEvents } from './events.js';
import {
  advanceDriverEpisodes,
  buildDriverEpisodeInfo,
  createEpisodeState,
  evaluateEpisode,
  initializeDriverEpisodes,
  resetDriverEpisodes,
} from './episode.js';
import { buildDriverMetrics } from './metrics.js';
import { buildEnvironmentObservation } from './observations.js';
import { resolveEnvironmentOptions } from './options.js';
import { applyEnvironmentPlacements, applyEnvironmentScenario, normalizeEnvironmentPlacements } from './scenarios.js';
import { buildActionSpec, buildObservationSpec } from './specs.js';

export function createPaddockEnvironment(options = {}) {
  let resolvedOptions = resolveEnvironmentOptions(options);
  let sim = createSimulationWithEnvironmentScenario(resolvedOptions);
  return createEnvironmentRuntime({
    getSimulation: () => sim,
    setSimulation(nextSim) {
      sim = nextSim;
    },
    createSimulation(nextOptions) {
      return createSimulationWithEnvironmentScenario(nextOptions);
    },
    getOptions: () => resolvedOptions,
    setOptions(nextOptions) {
      resolvedOptions = nextOptions;
    },
    afterReset() {},
    afterStep() {},
  });
}

function createSimulationWithEnvironmentScenario(options) {
  const sim = createRaceSimulation(options);
  applyEnvironmentScenario(sim, options);
  return sim;
}

export function createEnvironmentRuntime(host) {
  const episodeState = createEpisodeState();

  initializeControlledPitIntent(host);
  initializeDriverEpisodes(episodeState, host.getOptions().controlledDrivers);

  function reset(nextOptions = {}) {
    const options = resolveEnvironmentOptions({
      ...host.getOptions(),
      ...nextOptions,
    });
    host.setOptions(options);
    host.setSimulation(host.createSimulation(options));
    initializeControlledPitIntent(host);
    episodeState.step = 0;
    episodeState.previousSnapshot = null;
    initializeDriverEpisodes(episodeState, options.controlledDrivers);
    const result = buildResult({ host, episodeState, events: [], actionErrors: [] });
    episodeState.lastResult = result;
    host.afterReset(result);
    return result;
  }

  function step(actions = {}) {
    const options = host.getOptions();
    const sim = host.getSimulation();
    const { controlsByDriver, pitIntentByDriver, errors } = resolveActionMap(actions, options.controlledDrivers, {
      policy: options.actionPolicy,
    });

    Object.entries(controlsByDriver).forEach(([driverId, controls]) => {
      sim.setCarControls(driverId, controls);
    });
    Object.entries(pitIntentByDriver).forEach(([driverId, pitIntent]) => {
      const applied = Boolean(sim.setPitIntent?.(driverId, pitIntent));
      if (!applied && !isNoopPitIntent(pitIntent)) {
        handleActionError(`Pit intent could not be applied for controlled driver: ${driverId}`, options.actionPolicy, errors);
      }
    });

    episodeState.previousSnapshot = episodeState.lastResult?.state?.snapshot ?? sim.snapshot();
    const stepEvents = [];
    for (let index = 0; index < options.frameSkip; index += 1) {
      sim.step(FIXED_STEP);
      const events = typeof sim.consumeStepEvents === 'function'
        ? sim.consumeStepEvents()
        : sim.events;
      stepEvents.push(...collectStepEvents(events));
    }
    episodeState.step += 1;
    advanceDriverEpisodes(episodeState, options.controlledDrivers);
    const result = buildResult({ host, episodeState, events: stepEvents, actionErrors: errors, actions });
    episodeState.lastResult = result;
    host.afterStep(result);
    return result;
  }

  function getObservation() {
    return episodeState.lastResult?.observation ??
      buildResult({ host, episodeState, events: [], actionErrors: [] }).observation;
  }

  function getState() {
    return { snapshot: host.getSimulation().snapshot() };
  }

  function resetDrivers(placements = {}) {
    const options = host.getOptions();
    const sim = host.getSimulation();
    const driverIds = new Set(options.controlledDrivers);
    const normalizedPlacements = normalizeEnvironmentPlacements(placements, driverIds);
    const snapshot = sim.snapshot();
    const carsById = new Map(snapshot.cars.map((car) => [car.id, car]));
    applyEnvironmentPlacements(sim, snapshot.track, carsById, normalizedPlacements);
    Object.keys(normalizedPlacements).forEach((driverId) => {
      sim.clearCarControls?.(driverId);
      sim.setAutomaticPitIntentEnabled?.(driverId, false);
      sim.setPitIntent?.(driverId, 0);
    });
    resetDriverEpisodes(episodeState, Object.keys(normalizedPlacements));
    episodeState.previousSnapshot = null;
    const result = buildResult({ host, episodeState, events: [], actionErrors: [] });
    episodeState.lastResult = result;
    return result;
  }

  function getActionSpec() {
    return buildActionSpec(host.getOptions());
  }

  function getObservationSpec() {
    return buildObservationSpec(host.getOptions());
  }

  function destroy() {
    episodeState.lastResult = null;
    episodeState.previousSnapshot = null;
    episodeState.drivers?.clear?.();
  }

  return { reset, step, resetDrivers, getObservation, getState, getActionSpec, getObservationSpec, destroy };
}

function isNoopPitIntent(pitIntent) {
  if (pitIntent && typeof pitIntent === 'object') {
    return Number(pitIntent.intent ?? pitIntent.pitIntent) === 0;
  }
  return Number(pitIntent) === 0;
}

function initializeControlledPitIntent(host) {
  const sim = host.getSimulation?.();
  const options = host.getOptions?.();
  options?.controlledDrivers?.forEach?.((driverId) => {
    sim?.setAutomaticPitIntentEnabled?.(driverId, false);
    sim?.setPitIntent?.(driverId, 0);
  });
}

function buildResult({ host, episodeState, events, actionErrors, actions = {} }) {
  const options = host.getOptions();
  const snapshot = host.getSimulation().snapshot();
  const observation = buildEnvironmentObservation({
    snapshot,
    previousSnapshot: episodeState.previousSnapshot,
    options,
    events,
  });
  const episode = evaluateEpisode(snapshot, options, episodeState);
  const metrics = buildDriverMetrics({
    snapshot,
    previousSnapshot: episodeState.previousSnapshot,
    options,
    events,
  });
  const reward = computeReward({ options, observation, events, snapshot, actions, previousSnapshot: episodeState.previousSnapshot });
  return {
    observation,
    reward,
    metrics,
    terminated: episode.terminated,
    truncated: episode.truncated,
    done: episode.terminated || episode.truncated,
    events,
    state: { snapshot },
    info: {
      step: episodeState.step,
      elapsedSeconds: snapshot.time,
      seed: options.seed,
      trackSeed: options.trackSeed,
      controlledDrivers: [...options.controlledDrivers],
      actionErrors,
      endReason: episode.endReason,
      drivers: buildDriverEpisodeInfo(episodeState, options, episode),
    },
  };
}

function computeReward({ options, observation, events, snapshot, actions, previousSnapshot }) {
  if (!options.reward) return null;
  return Object.fromEntries(options.controlledDrivers.map((driverId) => [
    driverId,
    Number(options.reward({
      driverId,
      previous: previousSnapshot,
      current: observation[driverId],
      action: actions?.[driverId],
      events: observation[driverId]?.events ?? events,
      state: { snapshot },
    }) ?? 0),
  ]));
}
