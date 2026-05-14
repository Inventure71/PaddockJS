import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { handleActionError, resolveActionMap } from './actions.js';
import { collectStepEvents } from './events.js';
import {
  advanceDriverEpisodes,
  buildDriverEpisodeInfo,
  createEpisodeState,
  evaluateEpisode,
  initializeDriverEpisodes,
  markDestroyedDriverEpisodes,
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
  const sim = createRaceSimulation({ ...options, trackQueryIndex: shouldUseTrackQueryIndex(options) });
  applyEnvironmentScenario(sim, options);
  return sim;
}

function shouldUseTrackQueryIndex(options) {
  if (options.trackQueryIndex != null) return options.trackQueryIndex !== false;
  return canUseTrainingSnapshot(options, options.result?.stateOutput);
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

    episodeState.previousSnapshot = episodeState.lastRewardSnapshot ?? snapshotForResult(sim, options, options.result.stateOutput);
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

  function getState({ output = 'full' } = {}) {
    const sim = host.getSimulation();
    if (output === 'none') return null;
    if (output === 'minimal') return { snapshot: sim.snapshotObservation?.() ?? sim.snapshot() };
    return { snapshot: sim.snapshot() };
  }

  function resetDrivers(placements = {}, resultOptions = {}) {
    const options = host.getOptions();
    const sim = host.getSimulation();
    const driverIds = new Set(options.controlledDrivers);
    const normalizedPlacements = normalizeEnvironmentPlacements(placements, driverIds);
    const snapshot = sim.snapshotObservation?.() ?? sim.snapshot();
    const carsById = new Map(snapshot.cars.map((car) => [car.id, car]));
    applyEnvironmentPlacements(sim, snapshot.track, carsById, normalizedPlacements);
    Object.keys(normalizedPlacements).forEach((driverId) => {
      sim.clearCarControls?.(driverId);
      sim.setAutomaticPitIntentEnabled?.(driverId, false);
      sim.setPitIntent?.(driverId, 0);
      const car = sim.cars?.find?.((item) => item.id === driverId);
      if (car) sim.applyRunoffResponse?.(car);
    });
    resetDriverEpisodes(episodeState, Object.keys(normalizedPlacements));
    episodeState.previousSnapshot = null;
    const resetDriverIds = Object.keys(normalizedPlacements);
    const observationScope = resultOptions.observationScope ??
      resultOptions.resetDriversObservationScope ??
      options.result.resetDriversObservationScope;
    const result = buildResult({
      host,
      episodeState,
      events: [],
      actionErrors: [],
      controlledDrivers: observationScope === 'reset' ? resetDriverIds : options.controlledDrivers,
      stateOutput: resultOptions.stateOutput,
    });
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
    episodeState.lastObservationSnapshot = null;
    episodeState.lastRewardSnapshot = null;
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
    const car = sim?.cars?.find?.((item) => item.id === driverId);
    if (car) car.environmentControlled = true;
  });
}

function buildResult({
  host,
  episodeState,
  events,
  actionErrors,
  actions = {},
  controlledDrivers = null,
  stateOutput = null,
}) {
  const options = host.getOptions();
  const sim = host.getSimulation();
  const resultDrivers = controlledDrivers ?? options.controlledDrivers;
  const resolvedStateOutput = stateOutput ?? options.result.stateOutput;
  const observationSnapshot = snapshotForResult(sim, options, resolvedStateOutput);
  markDestroyedDriverEpisodes(episodeState, options.controlledDrivers, observationSnapshot);
  const observation = buildEnvironmentObservation({
    snapshot: observationSnapshot,
    previousSnapshot: episodeState.previousSnapshot,
    options,
    events,
    controlledDrivers: resultDrivers,
  });
  const episode = evaluateEpisode(observationSnapshot, options, episodeState);
  const metrics = buildDriverMetrics({
    snapshot: observationSnapshot,
    previousSnapshot: episodeState.previousSnapshot,
    options: { ...options, controlledDrivers: resultDrivers },
    events,
  });
  const rewardEpisodeInfo = buildDriverEpisodeInfo(episodeState, {
    ...options,
    controlledDrivers: resultDrivers,
  }, episode);
  const driverEpisodeInfo = buildDriverEpisodeInfo(episodeState, options, episode);
  const { state, rewardSnapshot } = buildResultState(sim, observationSnapshot, resolvedStateOutput);
  const reward = computeReward({
    options: { ...options, controlledDrivers: resultDrivers },
    observation,
    events,
    snapshot: rewardSnapshot,
    actions,
    previousSnapshot: episodeState.previousSnapshot,
    metrics,
    driverEpisodeInfo: rewardEpisodeInfo,
  });
  episodeState.lastObservationSnapshot = observationSnapshot;
  episodeState.lastRewardSnapshot = rewardSnapshot;
  return {
    observation,
    reward,
    metrics,
    terminated: episode.terminated,
    truncated: episode.truncated,
    done: episode.terminated || episode.truncated,
    events,
    state,
    info: {
      step: episodeState.step,
      elapsedSeconds: observationSnapshot.time,
      seed: options.seed,
      trackSeed: options.trackSeed,
      controlledDrivers: [...options.controlledDrivers],
      actionErrors,
      endReason: episode.endReason,
      drivers: driverEpisodeInfo,
    },
  };
}

function buildResultState(sim, observationSnapshot, stateOutput) {
  if (stateOutput === 'none') return { state: null, rewardSnapshot: observationSnapshot };
  if (stateOutput === 'minimal') return { state: { snapshot: observationSnapshot }, rewardSnapshot: observationSnapshot };
  const snapshot = sim.snapshot();
  return { state: { snapshot }, rewardSnapshot: snapshot };
}

function snapshotForResult(sim, options, stateOutput) {
  if (canUseTrainingSnapshot(options, stateOutput)) {
    return sim.snapshotTraining?.() ?? sim.snapshotObservation?.() ?? sim.snapshot();
  }
  return sim.snapshotObservation?.() ?? sim.snapshot();
}

function canUseTrainingSnapshot(options, stateOutput) {
  return stateOutput === 'none' &&
    options.observation?.output === 'vector' &&
    options.observation?.includeSchema === false;
}

function computeReward({ options, observation, events, snapshot, actions, previousSnapshot, metrics, driverEpisodeInfo }) {
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
      metrics: metrics?.[driverId] ?? null,
      episode: driverEpisodeInfo?.[driverId] ?? null,
    }) ?? 0),
  ]));
}
