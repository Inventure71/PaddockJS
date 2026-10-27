import { FIXED_STEP } from '../simulation/raceSimulation.js';
import { handleActionError, resolveActionMap } from './actions.js';
import { collectStepEvents } from './events.js';
import { advanceDriverEpisodes, createEpisodeState, initializeDriverEpisodes, resetDriverEpisodes } from './episode.js';
import { resolveEnvironmentOptions } from './options.js';
import { applyEnvironmentPlacements, normalizeEnvironmentPlacements } from './scenarios.js';
import { buildActionSpec, buildObservationSpec } from './specs.js';
import { initializeControlledPitIntent, resetControlledDriverState } from './driverReset.js';
import { createSimulationWithEnvironmentScenario } from './simulationSetup.js';
import { mergeEnvironmentResetOptions } from './resetOptions.js';
import { buildEnvironmentResult, snapshotForResult } from './results.js';
import { emitExternalRenderFrame } from './renderFrames.js';
import { clearMetricScratch, clearObservationScratch } from './scratch.js';

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

export function createEnvironmentRuntime(host) {
  const episodeState = createEpisodeState();

  initializeControlledPitIntent(host);
  initializeDriverEpisodes(episodeState, host.getOptions().controlledDrivers);

  function reset(nextOptions = {}) {
    const options = resolveEnvironmentOptions(mergeEnvironmentResetOptions(host.getOptions(), nextOptions));
    host.setOptions(options);
    host.setSimulation(host.createSimulation(options));
    initializeControlledPitIntent(host);
    episodeState.step = 0;
    episodeState.previousSnapshot = null;
    initializeDriverEpisodes(episodeState, options.controlledDrivers);
    const result = buildEnvironmentResult({ host, episodeState, events: [], actionErrors: [] });
    episodeState.lastResult = result;
    emitExternalRenderFrame(host, result, { source: 'reset' }, episodeState.lastObservationSnapshot);
    host.afterReset(result);
    return result;
  }

  function step(actions = {}) {
    const options = host.getOptions();
    const sim = host.getSimulation();
    const { controlsByDriver, pitIntentByDriver, errors } = resolveActionMap(actions, options.controlledDrivers, {
      policy: options.actionPolicy,
    });

    if (options.actionPolicy === 'report') {
      options.controlledDrivers.forEach((driverId) => {
        if (!Object.hasOwn(controlsByDriver, driverId)) sim.clearCarControls?.(driverId);
      });
    }
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
    const result = buildEnvironmentResult({
      host,
      episodeState,
      events: stepEvents,
      actionErrors: errors,
      actions,
      rewardEnabled: true,
    });
    episodeState.lastResult = result;
    emitExternalRenderFrame(host, result, { source: 'step', actions }, episodeState.lastObservationSnapshot);
    host.afterStep(result);
    return result;
  }

  function getObservation() {
    return episodeState.lastResult?.observation ??
      buildEnvironmentResult({ host, episodeState, events: [], actionErrors: [] }).observation;
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
    resetControlledDriverState(sim, Object.keys(normalizedPlacements));
    resetDriverEpisodes(episodeState, Object.keys(normalizedPlacements));
    episodeState.previousSnapshot = null;
    const resetDriverIds = Object.keys(normalizedPlacements);
    const observationScope = resultOptions.observationScope ??
      resultOptions.resetDriversObservationScope ??
      options.result.resetDriversObservationScope;
    const result = buildEnvironmentResult({
      host,
      episodeState,
      events: [],
      actionErrors: [],
      controlledDrivers: observationScope === 'reset' ? resetDriverIds : options.controlledDrivers,
      stateOutput: resultOptions.stateOutput,
    });
    episodeState.lastResult = result;
    emitExternalRenderFrame(host, result, {
      source: 'resetDrivers',
      resetDriverIds,
      observationScope,
    }, episodeState.lastObservationSnapshot);
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
    episodeState.destroyedCarsById?.clear?.();
    clearObservationScratch(episodeState.observationScratch);
    clearMetricScratch(episodeState.metricScratch);
  }

  return { reset, step, resetDrivers, getObservation, getState, getActionSpec, getObservationSpec, destroy };
}

function isNoopPitIntent(pitIntent) {
  if (pitIntent && typeof pitIntent === 'object') {
    return Number(pitIntent.intent ?? pitIntent.pitIntent) === 0;
  }
  return Number(pitIntent) === 0;
}
