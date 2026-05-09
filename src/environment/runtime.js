import { createRaceSimulation, FIXED_STEP } from '../simulation/raceSimulation.js';
import { handleActionError, resolveActionMap } from './actions.js';
import { collectStepEvents } from './events.js';
import { createEpisodeState, evaluateEpisode } from './episode.js';
import { buildEnvironmentObservation } from './observations.js';
import { resolveEnvironmentOptions } from './options.js';
import { applyEnvironmentScenario } from './scenarios.js';
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
      if (!applied) {
        handleActionError(`Pit intent could not be applied for controlled driver: ${driverId}`, options.actionPolicy, errors);
      }
    });

    episodeState.previousSnapshot = sim.snapshot();
    const stepEvents = [];
    for (let index = 0; index < options.frameSkip; index += 1) {
      sim.step(FIXED_STEP);
      stepEvents.push(...collectStepEvents(sim.snapshot().events));
    }
    episodeState.step += 1;
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

  function getActionSpec() {
    return buildActionSpec(host.getOptions());
  }

  function getObservationSpec() {
    return buildObservationSpec(host.getOptions());
  }

  function destroy() {
    episodeState.lastResult = null;
    episodeState.previousSnapshot = null;
  }

  return { reset, step, getObservation, getState, getActionSpec, getObservationSpec, destroy };
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
  const reward = computeReward({ options, observation, events, snapshot, actions, previousSnapshot: episodeState.previousSnapshot });
  return {
    observation,
    reward,
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
